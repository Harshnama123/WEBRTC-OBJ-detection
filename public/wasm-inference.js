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
            // Use global ORT from CDN script
            const ort = window.ort;

            // Load the model
            // Use absolute path and cache-busting param so it works from /phone and avoids 304
            const basePath = '/models/mobilenet-ssd.onnx';
            const bust = `v=${Date.now()}`;
            let url = `${basePath}?${bust}`;
            console.log('Loading ONNX model from', url);
            let resp = await fetch(url, { cache: 'reload', headers: { 'Cache-Control': 'no-cache' } });
            if (!resp.ok) {
                // Fallback without query param
                url = basePath;
                console.log('Reload failed with status', resp.status, 'retrying', url);
                resp = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-store' } });
            }
            let buffer = await resp.arrayBuffer();
            if (buffer.byteLength === 0) {
                console.warn('Model body empty, retrying with no-store');
                resp = await fetch(basePath, { cache: 'no-store', headers: { 'Cache-Control': 'no-store' } });
                buffer = await resp.arrayBuffer();
            }
            console.log('Model bytes:', buffer.byteLength);
            this.session = await ort.InferenceSession.create(new Uint8Array(buffer), {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            
            // Verify input and output names from the loaded model
            const inputNames = this.session.inputNames;
            const outputNames = this.session.outputNames;

            // Update config with actual tensor names
            if (inputNames.length > 0) {
                this.modelConfig.inputName = inputNames[0];
            }
            if (outputNames.length >= 2) {
                this.modelConfig.scoreOutput = outputNames[0];
                this.modelConfig.boxesOutput = outputNames[1];
            } else if (outputNames.length === 1) {
                // Some models output a single detections tensor
                this.modelConfig.scoreOutput = outputNames[0];
                this.modelConfig.boxesOutput = outputNames[0];
            }

            // Derive input shape from metadata if available
            const metadata = this.session.inputMetadata?.[this.modelConfig.inputName];
            if (metadata && Array.isArray(metadata.dimensions)) {
                const dims = metadata.dimensions.slice();
                // Replace dynamic dims (<=0) with sensible defaults
                for (let i = 0; i < dims.length; i++) {
                    if (typeof dims[i] !== 'number' || dims[i] <= 0) {
                        dims[i] = i === 0 ? 1 : (i >= 2 ? 300 : 3);
                    }
                }
                if (dims.length === 4) {
                    this.modelConfig.inputShape = dims;
                }
            }

            console.log('Model loaded successfully. Input:', inputNames, 'Outputs:', outputNames, 'Input shape:', this.modelConfig.inputShape);
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
            const ort = window.ort;
            const tensor = new ort.Tensor(
                'float32',
                preprocessedData,
                this.modelConfig.inputShape
            );

            // Run inference
            const feeds = {};
            feeds[this.modelConfig.inputName] = tensor;
            const results = await this.session.run(feeds);

            // Process results using robust parser that supports multiple SSD export formats
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

        // Create a source canvas with the original ImageData
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = imageData.width;
        sourceCanvas.height = imageData.height;
        const sourceCtx = sourceCanvas.getContext('2d');
        sourceCtx.putImageData(imageData, 0, 0);

        // Create a target canvas for resizing to model input size
        const targetCanvas = document.createElement('canvas');
        targetCanvas.width = width;
        targetCanvas.height = height;
        const targetCtx = targetCanvas.getContext('2d');
        targetCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, width, height);

        // Read resized pixels
        const resizedPixels = targetCtx.getImageData(0, 0, width, height).data;

        // Allocate space for CHW float32 tensor
        const preprocessedData = new Float32Array(batchSize * channels * height * width);

        // Convert RGBA to normalized CHW. Many MobileNet-SSD models expect BGR order.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelOffset = (y * width + x) * 4;
                const r = resizedPixels[pixelOffset];
                const g = resizedPixels[pixelOffset + 1];
                const b = resizedPixels[pixelOffset + 2];

                const bIndex = 0 * height * width + y * width + x; // B channel first
                const gIndex = 1 * height * width + y * width + x;
                const rIndex = 2 * height * width + y * width + x;

                preprocessedData[bIndex] = (b - meanValues[2]) / standardScale;
                preprocessedData[gIndex] = (g - meanValues[1]) / standardScale;
                preprocessedData[rIndex] = (r - meanValues[0]) / standardScale;
            }
        }

        return preprocessedData;
    }

    _postprocess(results) {
        const outNames = Object.keys(results);
        const detections = [];

        // Case 1: Separate score and boxes outputs
        const scores = results[this.modelConfig.scoreOutput];
        const boxes = results[this.modelConfig.boxesOutput];
        if (scores && boxes) {
            const [batchSize, numDetections, numClasses] = scores.dims;
            for (let i = 0; i < numDetections; i++) {
                let maxScore = -Infinity;
                let maxClass = -1;
                for (let j = 1; j < numClasses; j++) {
                    const score = scores.data[i * numClasses + j];
                    if (score > maxScore) {
                        maxScore = score;
                        maxClass = j;
                    }
                }
                if (maxScore >= this.modelConfig.scoreThreshold) {
                    const xmin = boxes.data[i * 4];
                    const ymin = boxes.data[i * 4 + 1];
                    const xmax = boxes.data[i * 4 + 2];
                    const ymax = boxes.data[i * 4 + 3];
                    detections.push({
                        label: this.modelConfig.classLabels[maxClass] || String(maxClass),
                        score: maxScore,
                        xmin: Math.max(0, Math.min(1, xmin)),
                        ymin: Math.max(0, Math.min(1, ymin)),
                        xmax: Math.max(0, Math.min(1, xmax)),
                        ymax: Math.max(0, Math.min(1, ymax))
                    });
                }
            }
            return detections;
        }

        // Case 2: Single detection output tensor (e.g., [1,1,N,7] or [1,N,7] or [N,7])
        const single = results[outNames[0]];
        if (single) {
            const dims = single.dims;
            const data = single.data;
            let numFields = 7; // [image_id, label, score, xmin, ymin, xmax, ymax]
            let numDet = 0;
            let offset = 0;
            if (dims.length === 4) {
                numDet = dims[2];
            } else if (dims.length === 3) {
                numDet = dims[1];
            } else if (dims.length === 2) {
                numDet = dims[0];
            } else {
                numDet = Math.floor(data.length / numFields);
            }
            for (let i = 0; i < numDet; i++) {
                const base = i * numFields + offset;
                const label = data[base + 1];
                const score = data[base + 2];
                const xmin = data[base + 3];
                const ymin = data[base + 4];
                const xmax = data[base + 5];
                const ymax = data[base + 6];
                if (score >= this.modelConfig.scoreThreshold) {
                    detections.push({
                        label: this.modelConfig.classLabels[label] || String(label),
                        score,
                        xmin: Math.max(0, Math.min(1, xmin)),
                        ymin: Math.max(0, Math.min(1, ymin)),
                        xmax: Math.max(0, Math.min(1, xmax)),
                        ymax: Math.max(0, Math.min(1, ymax))
                    });
                }
            }
            return detections;
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
