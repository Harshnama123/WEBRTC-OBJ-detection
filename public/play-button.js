function addPlayButton(video, statusElement) {
    const playButton = document.createElement('button');
    playButton.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #4CAF50;
        color: white;
        border: none;
        padding: 15px 30px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 18px;
        z-index: 1000;
    `;
    playButton.textContent = 'Tap to Play';
    playButton.onclick = async () => {
        try {
            await video.play();
            playButton.remove();
            statusElement.style.display = 'none';
            video.style.display = 'block';
        } catch (err) {
            console.error('Error playing video:', err);
        }
    };
    
    video.parentElement.appendChild(playButton);
    statusElement.textContent = 'Click or tap to start video';
}
