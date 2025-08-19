class ObjectDetector {
    constructor() {
        this.session = null;
        this.processing = false;
        this.frameQueue = [];
        this.MAX_QUEUE_SIZE = 3;
        
        // Model configuration
        this.modelConfig = {
            inputShape: [1, 3, 300, 300], // Default MobileNet-SSD input shape [batch, channels, height, width]
            meanValues: [127.5, 127.5, 127.5],
            standardScale: 127.5,
            scoreThreshold: 0.5,
            inputName: 'data', // Default MobileNet-SSD input tensor name
            scoreOutput: 'scores',
            boxesOutput: 'boxes',
            classLabels: [ // COCO dataset classes
                'background', 'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus',
                'train', 'truck', 'boat', 'traffic light', 'fire hydrant', 'stop sign',
                'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
                'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag',
                'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite',
                'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
                'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana',
                'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza',
                'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table',
                'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
                'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock',
                'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
            ]
        };
    }

    async loadModel() {
        try {
            // Initialize ONNX Runtime Web
            const ort = await import('onnxruntime-web');
            
            // Set WASM backend path (assumes onnxruntime-web files are in root of public)
            ort.env.wasm.wasmPaths = {
                'ort-wasm.wasm': '/node_modules/onnxruntime-web/dist/ort-wasm.wasm',
                'ort-wasm-simd.wasm': '/node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm',
                'ort-wasm-threaded.wasm': '/node_modules/onnxruntime-web/dist/ort-wasm-threaded.wasm'
            };

            // Load the model
            const modelPath = 'models/mobilenet-ssd.onnx';
            this.session = await ort.InferenceSession.create(modelPath, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            
            // Verify input and output names from the loaded model
            const inputNames = this.session.inputNames;
            const outputNames = this.session.outputNames;
            
            // Update config if needed based on actual model
            if (inputNames.length > 0) {
                this.modelConfig.inputName = inputNames[0];
            }
            if (outputNames.length >= 2) {
                // Assuming first output is scores and second is boxes
                this.modelConfig.scoreOutput = outputNames[0];
                this.modelConfig.boxesOutput = outputNames[1];
            }
            
            console.log('Model loaded successfully. Input:', inputNames, 'Outputs:', outputNames);
            return true;
        } catch (error) {
            console.error('Error loading model:', error);
            throw new Error('Failed to load object detection model');
        }
    }

    async detectObjects(imageData) {
        if (!this.session) {
            throw new Error('Model not loaded');
        }

        try {
            const startTime = Date.now();

            // Preprocess the image data
            const preprocessedData = this._preprocess(imageData);
            
            // Create input tensor
            const ort = await import('onnxruntime-web');
            const tensor = new ort.Tensor(
                'float32',
                preprocessedData,
                this.modelConfig.inputShape
            );

            // Run inference
            const feeds = {};
            feeds[this.modelConfig.inputName] = tensor;
            const results = await this.session.run(feeds);

            // Process results
            const detections = this._postprocess(results);

            const endTime = Date.now();

            return {
                frame_id: startTime,
                capture_ts: startTime,
                inference_ts: endTime,
                detections: detections,
                inference_time: endTime - startTime
            };
        } catch (error) {
            console.error('Detection error:', error);
            throw error;
        }
    }

    _preprocess(imageData) {
        const { inputShape, meanValues, standardScale } = this.modelConfig;
        const [batchSize, channels, height, width] = inputShape;

        // Create a temporary canvas for resizing
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // Draw and resize image
        ctx.drawImage(imageData.canvas || createImageBitmap(imageData), 0, 0, width, height);
        
        // Get pixel data
        const imagePixels = ctx.getImageData(0, 0, width, height).data;
        
        // Allocate space for the preprocessed data
        const preprocessedData = new Float32Array(batchSize * channels * height * width);
        
        // Convert pixels to normalized float values and transpose to CHW format
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelOffset = (y * width + x) * 4;
                for (let c = 0; c < channels; c++) {
                    const preprocessedIndex = c * height * width + y * width + x;
                    // Normalize pixel value
                    preprocessedData[preprocessedIndex] = 
                        (imagePixels[pixelOffset + c] - meanValues[c]) / standardScale;
                }
            }
        }

        return preprocessedData;
    }

    _postprocess(results) {
        const scores = results[this.modelConfig.scoreOutput];
        const boxes = results[this.modelConfig.boxesOutput];
        const detections = [];

        // Get dimensions from scores tensor
        const [batchSize, numDetections, numClasses] = scores.dims;
        
        for (let i = 0; i < numDetections; i++) {
            // Get the class with highest score
            let maxScore = -Infinity;
            let maxClass = -1;
            
            for (let j = 1; j < numClasses; j++) { // Skip background class (0)
                const score = scores.data[i * numClasses + j];
                if (score > maxScore) {
                    maxScore = score;
                    maxClass = j;
                }
            }
            
            // Filter by confidence threshold
            if (maxScore >= this.modelConfig.scoreThreshold) {
                // Get bounding box coordinates (normalized [0-1])
                const bbox = {
                    xmin: boxes.data[i * 4],
                    ymin: boxes.data[i * 4 + 1],
                    xmax: boxes.data[i * 4 + 2],
                    ymax: boxes.data[i * 4 + 3]
                };
                
                // Add detection to results
                detections.push({
                    label: this.modelConfig.classLabels[maxClass],
                    score: maxScore,
                    ...bbox
                });
            }
        }

        return detections;
    }

    addToQueue(frame) {
        if (this.frameQueue.length < this.MAX_QUEUE_SIZE) {
            this.frameQueue.push(frame);
            return true;
        }
        return false;
    }

    async processQueue() {
        if (this.processing || this.frameQueue.length === 0) {
            return;
        }

        this.processing = true;
        try {
            const frame = this.frameQueue.shift();
            const results = await this.detectObjects(frame);
            return results;
        } finally {
            this.processing = false;
            // Continue processing if there are more frames
            if (this.frameQueue.length > 0) {
                this.processQueue();
            }
        }
    }
}

// Export for use in other files
window.ObjectDetector = ObjectDetector;
