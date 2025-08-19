class VideoManager {
    constructor(videoElement, statusElement, statsElement) {
        this.video = videoElement;
        this.status = statusElement;
        this.stats = statsElement;
        this.playbackMonitor = null;
        this.isPlaying = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Video state events
        const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing', 'pause', 'waiting', 'seeked', 'ended', 'error'];
        events.forEach(event => {
            this.video.addEventListener(event, () => this.handleVideoEvent(event));
        });

        // Track changes to video state
        this.video.addEventListener('playing', () => {
            this.isPlaying = true;
            this.retryCount = 0;
            this.status.style.display = 'none';
            this.video.style.display = 'block';
        });

        this.video.addEventListener('pause', () => {
            this.isPlaying = false;
        });
    }

    handleVideoEvent(event) {
        console.log(`Video Event [${event}]:`, {
            readyState: this.video.readyState,
            paused: this.video.paused,
            time: this.video.currentTime,
            size: `${this.video.videoWidth}x${this.video.videoHeight}`
        });
    }

    async startPlayback() {
        if (!this.video.srcObject) {
            console.error('No video source available');
            return;
        }

        try {
            // Wait for enough data
            if (this.video.readyState < 2) { // HAVE_CURRENT_DATA
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Video load timeout')), 5000);
                    this.video.addEventListener('loadeddata', () => {
                        clearTimeout(timeout);
                        resolve();
                    }, { once: true });
                });
            }

            await this.video.play();
            console.log('✅ Playback started successfully');
            
            // Start monitoring playback
            this.startPlaybackMonitor();
            
            // Update stats
            if (this.stats) {
                this.updateStats();
            }

        } catch (error) {
            console.error('❌ Playback failed:', error);
            this.handlePlaybackError(error);
        }
    }

    startPlaybackMonitor() {
        // Clear any existing monitor
        if (this.playbackMonitor) {
            clearInterval(this.playbackMonitor);
        }

        // Start new monitor
        this.playbackMonitor = setInterval(() => {
            this.checkPlaybackState();
            this.updateStats();
        }, 1000);
    }

    async checkPlaybackState() {
        if (!this.video.srcObject || !this.video.srcObject.active) {
            console.warn('⚠️ Video stream inactive');
            return;
        }

        if (this.video.paused && !this.isWaitingForUser) {
            if (this.retryCount < this.maxRetries) {
                console.log('⚠️ Attempting to resume playback...');
                this.retryCount++;
                try {
                    await this.video.play();
                } catch (error) {
                    this.handlePlaybackError(error);
                }
            } else {
                console.warn('⚠️ Max retry attempts reached');
                this.showPlayButton();
            }
        }
    }

    updateStats() {
        if (!this.stats) return;
        
        const track = this.video.srcObject?.getVideoTracks()[0];
        if (track) {
            const settings = track.getSettings();
            this.stats.textContent = `${settings.width}x${settings.height}@${settings.frameRate}fps`;
            this.stats.style.display = 'block';
        }
    }

    handlePlaybackError(error) {
        if (error.name === 'NotAllowedError') {
            this.showPlayButton();
        } else {
            console.error('Playback error:', error);
            this.status.textContent = 'Video playback error. Click to retry.';
            this.status.style.display = 'block';
        }
    }

    showPlayButton() {
        this.isWaitingForUser = true;
        this.status.innerHTML = `
            <div style="text-align: center;">
                <button onclick="videoManager.startPlayback()" style="
                    background: #4CAF50;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 16px;
                    margin-top: 10px;
                ">Click to Play</button>
            </div>
        `;
        this.status.style.display = 'block';
    }

    stop() {
        if (this.playbackMonitor) {
            clearInterval(this.playbackMonitor);
        }
        if (this.video.srcObject) {
            this.video.srcObject.getTracks().forEach(track => track.stop());
            this.video.srcObject = null;
        }
        this.isPlaying = false;
        this.retryCount = 0;
    }
}
