// Global variables
let audioContext;
let mediaRecorder;
let audioChunks = [];
let currentAudioBuffer;
let isRecording = false;
let isPlaying = false;
let audioSource;
let audioHistory = [];
let redoHistory = [];
let wavesurfer;
let tracks = [];
let currentTrack = null;
let clipboard = null;
let selectedTrack = null;
let selectionStart = 0;
let selectionEnd = 0;
let isSelectionActive = false;
let currentZoomLevel = 1;
let projectName = "Untitled Project";
let currentTool = null;

// Track class to manage individual audio tracks
class AudioTrack {
    constructor(type, id) {
        this.type = type; // 'stereo' or 'mono'
        this.id = id;
        this.name = `Track ${id}`;
        this.audioBuffer = null;
        this.waveform = null;
        this.isMuted = false;
        this.isSolo = false;
        this.volume = 1.0;
        this.pan = 0.0;
        this.regions = [];
        this.effects = [];
        this.startTime = 0; // Track position in timeline
        this.isSelected = false;
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.isSelectionActive = false;
        this.originalBuffer = null; // Store original audio for undo/redo
    }

    initializeWaveform(containerId) {
        this.waveform = WaveSurfer.create({
            container: `#${containerId}`,
            waveColor: '#4ade80',
            progressColor: '#4ade80',
            cursorColor: '#4ade80',
            barWidth: 2,
            barRadius: 3,
            cursorWidth: 1,
            height: 100,
            barGap: 3,
            responsive: true,
            plugins: [
                WaveSurfer.regions.create({
                    regions: this.regions,
                    dragSelection: {
                        slop: 5
                    }
                }),
                WaveSurfer.timeline.create({
                    container: `#timeline-${this.id}`
                })
            ]
        });

        this.waveform.on('ready', () => {
            updateUIState();
        });

        this.waveform.on('finish', () => {
            if (this === currentTrack) {
                updateUIState();
            }
        });

        // Add selection event listeners
        this.waveform.on('region-created', (region) => {
            this.selectionStart = region.start;
            this.selectionEnd = region.end;
            this.isSelectionActive = true;
            updateSelectionUI();
        });

        this.waveform.on('region-updated', (region) => {
            this.selectionStart = region.start;
            this.selectionEnd = region.end;
            this.isSelectionActive = true;
            updateSelectionUI();
        });

        this.waveform.on('region-removed', () => {
            this.isSelectionActive = false;
            updateSelectionUI();
        });

        // Add click event for track selection
        this.waveform.on('click', () => {
            selectTrack(this);
        });
    }

    setAudioBuffer(buffer) {
        // Store original buffer for undo/redo
        if (!this.originalBuffer) {
            this.originalBuffer = buffer;
        }
        
        this.audioBuffer = buffer;
        if (this.waveform) {
            const audioBlob = new Blob([buffer], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(audioBlob);
            this.waveform.load(audioUrl);
        }
    }

    applyEffect(effect) {
        this.effects.push(effect);
        // Apply effect to audio buffer
        if (this.audioBuffer) {
            const effectProcessor = new EffectProcessor(this.audioBuffer, effect);
            effectProcessor.process().then(processedBuffer => {
                this.setAudioBuffer(processedBuffer);
                saveState(); // Save state after effect is applied
            });
        }
    }

    removeEffect(effectIndex) {
        if (effectIndex >= 0 && effectIndex < this.effects.length) {
            this.effects.splice(effectIndex, 1);
            // Reapply remaining effects
            let buffer = this.originalBuffer;
            this.effects.forEach(effect => {
                const processor = new EffectProcessor(buffer, effect);
                buffer = processor.process();
            });
            this.setAudioBuffer(buffer);
            saveState(); // Save state after effect is removed
        }
    }

    // Get selected region of audio
    getSelectedRegion() {
        if (this.isSelectionActive) {
            return {
                start: this.selectionStart,
                end: this.selectionEnd,
                buffer: this.audioBuffer
            };
        }
        return null;
    }

    // Clear selection
    clearSelection() {
        if (this.waveform) {
            this.waveform.clearRegions();
            this.isSelectionActive = false;
            updateSelectionUI();
        }
    }

    // Set track position in timeline
    setStartTime(time) {
        this.startTime = time;
        if (this.waveform) {
            // Update waveform position
            // This would require additional implementation
        }
    }

    // Get track duration
    getDuration() {
        if (this.audioBuffer) {
            return this.audioBuffer.duration;
        }
        return 0;
    }

    // Get track end time
    getEndTime() {
        return this.startTime + this.getDuration();
    }
}

// Effect processor class
class EffectProcessor {
    constructor(buffer, effect) {
        this.buffer = buffer;
        this.effect = effect;
    }

    async process() {
        const offlineCtx = new OfflineAudioContext(
            this.buffer.numberOfChannels,
            this.buffer.length,
            this.buffer.sampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = this.buffer;

        let effectNode;
        switch (this.effect.type) {
            case 'reverb':
                effectNode = createReverb(offlineCtx, this.effect.params);
                break;
            case 'echo':
                effectNode = createEcho(offlineCtx, this.effect.params);
                break;
            case 'equalizer':
                effectNode = createEqualizer(offlineCtx, this.effect.params);
                break;
        }

        if (effectNode) {
            source.connect(effectNode);
            effectNode.connect(offlineCtx.destination);
        } else {
            source.connect(offlineCtx.destination);
        }

        source.start();
        return await offlineCtx.startRendering();
    }
}

// Effect creation functions
function createReverb(context, params) {
    const convolver = context.createConvolver();
    const reverbTime = params.time || 2.0;
    const sampleRate = context.sampleRate;
    const length = sampleRate * reverbTime;
    const impulse = context.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        left[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, params.decay || 1);
        right[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, params.decay || 1);
    }

    convolver.buffer = impulse;
    return convolver;
}

function createEcho(context, params) {
    const delay = context.createDelay();
    const feedback = context.createGain();
    const wet = context.createGain();

    delay.delayTime.value = params.delay || 0.3;
    feedback.gain.value = params.feedback || 0.5;
    wet.gain.value = params.mix || 0.5;

    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);

    return wet;
}

function createEqualizer(context, params) {
    const eq = context.createBiquadFilter();
    eq.type = params.type || 'peaking';
    eq.frequency.value = params.frequency || 1000;
    eq.gain.value = params.gain || 0;
    eq.Q.value = params.Q || 1;
    return eq;
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing audio editor...');
    
    // Initialize audio context
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Audio context initialized');
    } catch (error) {
        console.error('Error initializing audio context:', error);
        alert('Error initializing audio. Please check your browser settings.');
    }

    // Initialize waveform
    initializeWaveform();
    
    // Initialize UI
    updateUI();
    
    // Main controls
    const recordBtn = document.getElementById('record-btn');
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const homeBtn = document.getElementById('home-btn');
    
    if (recordBtn) {
        recordBtn.addEventListener('click', () => {
            // Check if a track is selected
            const selected = getSelectedTrack();
            if (!selected) {
                alert('Please select a track before recording.');
                return;
            }
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (isPlaying) {
                stopPlayback();
            } else {
                playAudio();
            }
        });
    }
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (isRecording) {
                stopRecording();
            }
            if (isPlaying) {
                stopPlayback();
            }
        });
    }
    if (undoBtn) {
        undoBtn.addEventListener('click', undoLastOperation);
    }
    if (redoBtn) {
        redoBtn.addEventListener('click', redo);
    }
    if (homeBtn) {
        homeBtn.addEventListener('click', () => {
            window.location.href = 'home.html';
        });
    }
    // Track add buttons
    const addMonoTrackBtn = document.getElementById('add-mono-track-btn');
    const addStereoTrackBtn = document.getElementById('add-stereo-track-btn');
    if (addMonoTrackBtn) addMonoTrackBtn.addEventListener('click', addMonoTrack);
    if (addStereoTrackBtn) addStereoTrackBtn.addEventListener('click', addStereoTrack);
    // Tool selection
    const selectionToolBtn = document.getElementById('selection-tool-btn');
    const envelopeToolBtn = document.getElementById('envelope-tool-btn');
    if (selectionToolBtn) selectionToolBtn.addEventListener('click', () => { selectionTool(); updateToolUI(); });
    if (envelopeToolBtn) envelopeToolBtn.addEventListener('click', () => { envelopeTool(); updateToolUI(); });
    // Menu dropdowns (keep as is for now)
    // ... existing code ...
    // Track controls (event delegation)
    const trackList = document.getElementById('track-list');
    if (trackList) {
        trackList.addEventListener('click', (e) => {
            const li = e.target.closest('li.track');
            if (li) {
                // Extract track id from li id (format: track-1, track-2, ...)
                const trackId = parseInt(li.id.replace('track-', ''));
                if (!isNaN(trackId)) {
                    // Unselect all tracks
                    tracks.forEach(t => t.isSelected = false);
                    // Select the clicked track
                    const track = tracks.find(t => t.id === trackId);
                    if (track) {
                        track.isSelected = true;
                        updateTrackList();
                    }
                }
            }
        });
        // Volume and pan sliders
        trackList.addEventListener('input', (e) => {
            const input = e.target;
            const li = input.closest('li.track');
            if (!li) return;
            const trackId = li.id;
            const track = tracks.find(t => t.id === trackId);
            if (!track) return;
            if (input.classList.contains('volume-slider')) {
                track.volume = parseFloat(input.value);
                updateUI();
            } else if (input.classList.contains('pan-slider')) {
                track.pan = parseFloat(input.value);
                updateUI();
            }
        });
    }
    // ... existing code ...
});

// Initialize the waveform display
function initializeWaveform() {
    console.log('Initializing waveform...');
    
    // Create a new WaveSurfer instance
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#4ade80',
        progressColor: '#eab308',
        cursorColor: '#ef4444',
        barWidth: 2,
        barRadius: 3,
        cursorWidth: 1,
        height: 200,
        barGap: 3,
        responsive: true,
        normalize: true,
        partialRender: true,
        minPxPerSec: 1,
        scrollParent: true
    });

    // Store the wavesurfer instance globally
    window.wavesurfer = wavesurfer;

    // Initialize timeline
    const timeline = WaveSurfer.create({
        container: '#waveform-timeline',
        waveColor: 'transparent',
        progressColor: 'transparent',
        cursorColor: '#ef4444',
        cursorWidth: 1,
        height: 20,
        responsive: true,
        normalize: true,
        partialRender: true,
        minPxPerSec: 1,
        scrollParent: true
    });

    // Store the timeline instance globally
    window.timeline = timeline;

    console.log('Waveform initialized successfully');
}

// Update UI state
function updateUI() {
    console.log('Updating UI state...');
    
    // Update button states
    const recordButton = document.getElementById('record-btn');
    const playButton = document.getElementById('play-btn');
    const stopButton = document.getElementById('stop-btn');
    const undoButton = document.getElementById('undo-btn');
    const redoButton = document.getElementById('redo-btn');
    
    if (recordButton) {
        recordButton.disabled = isPlaying; // Only disable when playing, not when recording
        if (isRecording) {
            recordButton.classList.add('recording');
            recordButton.innerHTML = '<i class="fas fa-stop"></i> Stop Recording';
        } else {
            recordButton.classList.remove('recording');
            recordButton.innerHTML = '<i class="fas fa-microphone"></i> Record';
        }
    }
    if (playButton) {
        playButton.disabled = isRecording || isPlaying;
        if (isPlaying) {
            playButton.classList.add('playing');
        } else {
            playButton.classList.remove('playing');
        }
    }
    if (stopButton) stopButton.disabled = !isRecording && !isPlaying;
    if (undoButton) undoButton.disabled = audioHistory.length === 0;
    if (redoButton) redoButton.disabled = redoHistory.length === 0;
    
    // Update track list
    updateTrackList();
}

// Track management functions
function addStereoTrack() {
    console.log('Adding stereo track...');
    const trackId = tracks.length + 1;
    const track = new AudioTrack('stereo', trackId);
    // Ensure the new track is not selected by default
    track.isSelected = false;
    tracks.push(track);
    updateTrackList();
    // Do not select the new track automatically
}

function addMonoTrack() {
    console.log('Adding mono track...');
    const trackId = tracks.length + 1;
    const track = new AudioTrack('mono', trackId);
    // Ensure the new track is not selected by default
    track.isSelected = false;
    tracks.push(track);
    updateTrackList();
    // Do not select the new track automatically
}

function updateTrackList() {
    console.log('Updating track list...');
    const trackList = document.getElementById('track-list');
    if (!trackList) {
        console.error('Track list element not found');
        return;
    }
    trackList.innerHTML = '';
    tracks.forEach(track => {
        const li = document.createElement('li');
        li.className = `track${track.type === 'mono' ? ' mono' : ''}${track.isSelected ? ' selected' : ''}`;
        li.id = `track-${track.id}`;
        li.innerHTML = `
            <div class="track-header">
              <span class="track-title">${track.name}</span>
              <button class="track-menu-btn"><i class="fas fa-ellipsis-h"></i></button>
            </div>
            <div class="track-controls-row">
              <button class="mute-btn${track.isMuted ? ' active' : ''}">Mute</button>
              <button class="solo-btn${track.isSolo ? ' active' : ''}">Solo</button>
            </div>
            <button class="effects-btn">Effects</button>
            <div class="slider-group">
              <span class="slider-label">-</span>
              <input type="range" class="volume-slider" min="0" max="1" step="0.01" value="${track.volume}">
              <span class="slider-label">+</span>
            </div>
            <div class="slider-group">
              <span class="slider-label">L</span>
              <input type="range" class="pan-slider" min="-1" max="1" step="0.01" value="${track.pan}">
              <span class="slider-label">R</span>
            </div>
        `;
        trackList.appendChild(li);
    });
}

function selectTrack(track) {
    console.log('Selecting track:', track.id);
    selectedTrack = track;
    updateUI();
}

function toggleMute(trackId) {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
        track.isMuted = !track.isMuted;
        updateTrackList();
    }
}

function toggleSolo(trackId) {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
        track.isSolo = !track.isSolo;
        updateTrackList();
    }
}

function setVolume(trackId, volume) {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
        track.volume = parseFloat(volume);
        if (track.waveform) {
            track.waveform.setVolume(volume);
        }
        updateTrackList();
    }
}

function setPan(trackId, pan) {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
        track.pan = parseFloat(pan);
        // Implement panning logic here
        updateTrackList();
    }
}

// Recording functions
async function startRecording() {
    console.log('Starting recording...');
    const selectedTrack = getSelectedTrack();
    if (!selectedTrack) {
        alert('Please select a track first');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        isRecording = true;

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            selectedTrack.setAudioBuffer(audioBuffer);
            // Display waveform for the selected track after recording
            displayWaveform(selectedTrack);
            isRecording = false;
            updateUI();
        };

        mediaRecorder.start();
        updateUI();
    } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Error accessing microphone. Please check your permissions.');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        updateUI();
    }
}

// Playback functions
function playAudio() {
    if (isPlaying) return;
    
    // Play all unmuted tracks
    let anyTrackPlaying = false;
    tracks.forEach(track => {
        if (!track.isMuted && track.waveform && track.audioBuffer) {
            track.waveform.play();
            anyTrackPlaying = true;
        }
    });
    
    if (anyTrackPlaying) {
        isPlaying = true;
        updateUIState();
    }
}

function stopPlayback() {
    if (!isPlaying) return;
    
    tracks.forEach(track => {
        if (track.waveform) {
            track.waveform.stop();
        }
    });
    
    isPlaying = false;
    updateUIState();
}

// Edit functions
function undoLastOperation() {
    if (audioHistory.length > 0) {
        const lastOperation = audioHistory.pop();
        if (lastOperation.track) {
            // Store current state in redo history
            redoHistory.push({
                track: lastOperation.track,
                buffer: lastOperation.track.audioBuffer
            });
            
            // Restore previous state
            lastOperation.track.setAudioBuffer(lastOperation.buffer);
            updateUI();
        }
    }
}

function redo() {
    if (redoHistory.length > 0) {
        const nextOperation = redoHistory.pop();
        if (nextOperation.track) {
            // Store current state in undo history
            audioHistory.push({
                track: nextOperation.track,
                buffer: nextOperation.track.audioBuffer
            });
            
            // Restore next state
            nextOperation.track.setAudioBuffer(nextOperation.buffer);
            updateUI();
        }
    }
}

function cut() {
    console.log('Cutting selection...');
    if (selectedTrack && selectedTrack.waveform) {
        const selection = selectedTrack.waveform.getSelectedRegion();
        if (selection) {
            clipboard = {
                buffer: selectedTrack.audioBuffer,
                start: selection.start,
                end: selection.end
            };
            // Remove the selected portion
            const newBuffer = removeAudioSection(selectedTrack.audioBuffer, selection.start, selection.end);
            selectedTrack.setAudioBuffer(newBuffer);
            displayWaveform(selectedTrack);
            updateUI();
        } else {
            alert('Please select a region to cut.');
        }
    }
}

function copy() {
    console.log('Copying selection...');
    if (selectedTrack && selectedTrack.waveform) {
        const selection = selectedTrack.waveform.getSelectedRegion();
        if (selection) {
            clipboard = {
                buffer: selectedTrack.audioBuffer,
                start: selection.start,
                end: selection.end
            };
        } else {
            alert('Please select a region to copy.');
        }
    }
}

function paste() {
    console.log('Pasting selection...');
    if (selectedTrack && selectedTrack.waveform && clipboard) {
        const position = selectedTrack.waveform.getCurrentTime();
        const newBuffer = insertAudioSection(
            selectedTrack.audioBuffer,
            clipboard.buffer,
            position,
            clipboard.start,
            clipboard.end
        );
        selectedTrack.setAudioBuffer(newBuffer);
        displayWaveform(selectedTrack);
        updateUI();
    }
}

// Effect functions
function showEffects(trackId) {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
        const effectsModal = document.createElement('div');
        effectsModal.className = 'effects-modal';
        effectsModal.innerHTML = `
            <div class="effects-content">
                <h3>Effects for ${track.name}</h3>
                <div class="effects-list">
                    ${track.effects.map((effect, index) => `
                        <div class="effect-item">
                            <span>${effect.type}</span>
                            <button onclick="removeEffect('${trackId}', ${index})">Remove</button>
                        </div>
                    `).join('')}
                </div>
                <div class="add-effect">
                    <select id="effect-type">
                        <option value="reverb">Reverb</option>
                        <option value="echo">Echo</option>
                        <option value="equalizer">Equalizer</option>
                    </select>
                    <button onclick="addEffect('${trackId}')">Add Effect</button>
                </div>
            </div>
        `;
        document.body.appendChild(effectsModal);
    }
}

function addEffect(trackId) {
    const track = tracks.find(t => t.id === trackId);
    const effectType = document.getElementById('effect-type').value;
    
    if (track) {
        const effect = {
            type: effectType,
            params: getDefaultEffectParams(effectType)
        };
        track.applyEffect(effect);
        closeEffectsModal();
    }
}

function removeEffect(trackId, effectIndex) {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
        track.removeEffect(effectIndex);
        closeEffectsModal();
    }
}

function getDefaultEffectParams(type) {
    switch (type) {
        case 'reverb':
            return { time: 2.0, decay: 1 };
        case 'echo':
            return { delay: 0.3, feedback: 0.5, mix: 0.5 };
        case 'equalizer':
            return { type: 'peaking', frequency: 1000, gain: 0, Q: 1 };
    }
}

function closeEffectsModal() {
    const modal = document.querySelector('.effects-modal');
    if (modal) {
        modal.remove();
    }
}

// UI update functions
function updateUIState() {
    const recordBtn = document.querySelector('button[onclick="record()"]');
    const playBtn = document.querySelector('button[onclick="play()"]');
    const stopBtn = document.querySelector('button[onclick="stop()"]');
    const undoBtn = document.querySelector('button[onclick="undo()"]');
    
    if (recordBtn) recordBtn.disabled = isRecording;
    if (playBtn) playBtn.disabled = isPlaying || !tracks.some(t => t.audioBuffer);
    if (stopBtn) stopBtn.disabled = !isPlaying && !isRecording;
    if (undoBtn) undoBtn.disabled = audioHistory.length === 0;
}

function updateTrackUI(track) {
    const trackElement = document.getElementById(`track-${track.id}`);
    if (trackElement) {
        // Update select button
        const selectBtn = trackElement.querySelector('.select-btn');
        if (selectBtn) {
            selectBtn.innerHTML = track.isSelected ? 
                '<i class="fas fa-check-square"></i> Unselect' : 
                '<i class="fas fa-square"></i> Select';
            selectBtn.classList.toggle('active', track.isSelected);
        }
        
        // Update mute button
        const muteBtn = trackElement.querySelector('.mute-btn');
        if (muteBtn) {
            muteBtn.innerHTML = track.isMuted ? 
                '<i class="fas fa-volume-mute"></i>' : 
                '<i class="fas fa-volume-up"></i>';
            muteBtn.classList.toggle('active', track.isMuted);
        }
        
        // Update solo button
        const soloBtn = trackElement.querySelector('.solo-btn');
        if (soloBtn) {
            soloBtn.innerHTML = track.isSolo ? 
                '<i class="fas fa-star"></i>' : 
                '<i class="fas fa-headphones"></i>';
            soloBtn.classList.toggle('active', track.isSolo);
        }
        
        // Update volume display
        const volumeValue = trackElement.querySelector('.volume-slider').nextElementSibling;
        if (volumeValue) {
            volumeValue.textContent = `${Math.round(track.volume * 100)}%`;
        }
        
        // Update pan display
        const panValue = trackElement.querySelector('.pan-slider').nextElementSibling;
        if (panValue) {
            panValue.textContent = track.pan === 0 ? 'C' : 
                track.pan > 0 ? `R${Math.round(track.pan * 100)}` : 
                `L${Math.round(-track.pan * 100)}`;
        }
        
        // Update track element classes
        trackElement.classList.toggle('selected', track.isSelected);
        trackElement.classList.toggle('muted', track.isMuted);
        trackElement.classList.toggle('solo', track.isSolo);
    }
}

// Display waveform for a track
function displayWaveform(track) {
    console.log('Displaying waveform for track:', track.id);
    if (track.audioBuffer) {
        // Destroy previous instance if exists
        if (window.wavesurfer) {
            window.wavesurfer.destroy();
        }
        const canvasesContainer = document.querySelector('.canvases');
        if (canvasesContainer) {
            canvasesContainer.innerHTML = '';
        }
        // Create new instance
        const wavesurfer = WaveSurfer.create({
            container: '.canvases',
            waveColor: '#4ade80',
            progressColor: '#eab308',
            cursorColor: '#ef4444',
            barWidth: 2,
            barRadius: 3,
            cursorWidth: 1,
            height: 200,
            barGap: 3,
            responsive: true,
            normalize: true,
            partialRender: true
        });
        // Convert AudioBuffer to WAV and load
        const wavBuffer = audioBufferToWav(track.audioBuffer);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        wavesurfer.loadBlob(blob);
        track.waveform = wavesurfer;
        window.wavesurfer = wavesurfer;
    }
}

// Add track deletion function
function deleteTrack(trackId) {
    if (confirm('Are you sure you want to delete this track?')) {
        const trackIndex = tracks.findIndex(t => t.id === trackId);
        if (trackIndex !== -1) {
            // Remove track from array
            tracks.splice(trackIndex, 1);
            
            // Remove track element from DOM
            const trackElement = document.getElementById(`track-${trackId}`);
            if (trackElement) {
                trackElement.remove();
            }
            
            // Update track numbers
            updateTrackNumbers();
            
            // Update UI
            updateUIState();
        }
    }
}

// Update track numbers after deletion
function updateTrackNumbers() {
    const trackElements = document.querySelectorAll('.track');
    trackElements.forEach((element, index) => {
        const trackId = index + 1;
        const trackNumber = element.querySelector('.track-number');
        const trackName = element.querySelector('.track-name');
        
        if (trackNumber) trackNumber.textContent = trackId;
        if (trackName) trackName.textContent = `Track ${trackId}`;
        
        // Update track ID in tracks array
        if (tracks[index]) {
            tracks[index].id = trackId;
        }
    });
}

// Zoom functions
function zoomIn() {
    console.log('Zooming in...');
    if (selectedTrack && selectedTrack.waveform) {
        const currentZoom = selectedTrack.waveform.params.minPxPerSec || 1;
        selectedTrack.waveform.zoom(currentZoom * 2);
    } else if (wavesurfer) {
        const currentZoom = wavesurfer.params.minPxPerSec || 1;
        wavesurfer.zoom(currentZoom * 2);
    }
}

function zoomOut() {
    console.log('Zooming out...');
    if (selectedTrack && selectedTrack.waveform) {
        const currentZoom = selectedTrack.waveform.params.minPxPerSec || 1;
        selectedTrack.waveform.zoom(Math.max(1, currentZoom / 2));
    } else if (wavesurfer) {
        const currentZoom = wavesurfer.params.minPxPerSec || 1;
        wavesurfer.zoom(Math.max(1, currentZoom / 2));
    }
}

// Audio generation functions
function generateTone() {
    console.log('Generating tone...');
    if (!selectedTrack) {
        alert('Please select a track first.');
        return;
    }

    const duration = 2.0; // 2 seconds
    const frequency = 440; // A4 note
    const amplitude = 0.5;
    const sampleRate = audioContext.sampleRate;
    const numSamples = duration * sampleRate;
    
    const buffer = audioContext.createBuffer(
        selectedTrack.type === 'stereo' ? 2 : 1,
        numSamples,
        sampleRate
    );

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < numSamples; i++) {
            channelData[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
        }
    }

    selectedTrack.setAudioBuffer(buffer);
    displayWaveform(selectedTrack);
    updateUI();
}

function generateNoise() {
    console.log('Generating noise...');
    if (!selectedTrack) {
        alert('Please select a track first.');
        return;
    }

    const duration = 2.0; // 2 seconds
    const amplitude = 0.5;
    const sampleRate = audioContext.sampleRate;
    const numSamples = duration * sampleRate;
    
    const buffer = audioContext.createBuffer(
        selectedTrack.type === 'stereo' ? 2 : 1,
        numSamples,
        sampleRate
    );

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < numSamples; i++) {
            channelData[i] = amplitude * (Math.random() * 2 - 1);
        }
    }

    selectedTrack.setAudioBuffer(buffer);
    displayWaveform(selectedTrack);
    updateUI();
}

// Helper functions
function removeAudioSection(buffer, start, end) {
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const newLength = buffer.length - (endSample - startSample);
    
    const newBuffer = audioContext.createBuffer(
        buffer.numberOfChannels,
        newLength,
        sampleRate
    );
    
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const oldData = buffer.getChannelData(channel);
        const newData = newBuffer.getChannelData(channel);
        
        for (let i = 0, j = 0; i < oldData.length; i++) {
            if (i < startSample || i >= endSample) {
                newData[j++] = oldData[i];
            }
        }
    }
    
    return newBuffer;
}

function insertAudioSection(targetBuffer, sourceBuffer, position, start, end) {
    const sampleRate = targetBuffer.sampleRate;
    const positionSample = Math.floor(position * sampleRate);
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const insertLength = endSample - startSample;
    
    const newBuffer = audioContext.createBuffer(
        targetBuffer.numberOfChannels,
        targetBuffer.length + insertLength,
        sampleRate
    );
    
    for (let channel = 0; channel < targetBuffer.numberOfChannels; channel++) {
        const targetData = targetBuffer.getChannelData(channel);
        const sourceData = sourceBuffer.getChannelData(channel);
        const newData = newBuffer.getChannelData(channel);
        
        let i = 0;
        for (; i < positionSample; i++) {
            newData[i] = targetData[i];
        }
        
        for (let j = startSample; j < endSample; j++) {
            newData[i++] = sourceData[j];
        }
        
        for (let j = positionSample; j < targetData.length; j++) {
            newData[i++] = targetData[j];
        }
    }
    
    return newBuffer;
}

// Project management functions
function newProject() {
    const modal = document.getElementById('project-modal');
    if (modal) {
        modal.classList.add('show');
    } else {
        console.error('Project modal not found');
    }
}

function openProject() {
    // In a real implementation, this would open a file dialog
    alert('Open project functionality would be implemented here.');
}

function saveProject() {
    // In a real implementation, this would save the project to a file
    alert('Project saved!');
}

function exportProject() {
    // In a real implementation, this would export the project to a file
    alert('Export project functionality would be implemented here.');
}

// Tool functions
function selectionTool() {
    currentTool = 'selection';
    updateToolUI();
}

function envelopeTool() {
    currentTool = 'envelope';
    updateToolUI();
}

function updateToolUI() {
    const selectionToolBtn = document.getElementById('selection-tool-btn');
    const envelopeToolBtn = document.getElementById('envelope-tool-btn');
    
    if (selectionToolBtn) {
        selectionToolBtn.classList.toggle('active', currentTool === 'selection');
    }
    if (envelopeToolBtn) {
        envelopeToolBtn.classList.toggle('active', currentTool === 'envelope');
    }
}

// Export functions to global scope
window.updateUI = updateUI;
window.initializeWaveform = initializeWaveform;
window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.playAudio = playAudio;
window.stopPlayback = stopPlayback;
window.undoLastOperation = undoLastOperation;
window.redo = redo;
window.generateTone = generateTone;
window.generateNoise = generateNoise;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.addStereoTrack = addStereoTrack;
window.addMonoTrack = addMonoTrack;
window.deleteTrack = deleteTrack;
window.toggleMute = toggleMute;
window.toggleSolo = toggleSolo;
window.setVolume = setVolume;
window.setPan = setPan;
window.showEffects = showEffects;
window.addEffect = addEffect;
window.removeEffect = removeEffect;
window.closeEffectsModal = closeEffectsModal;
window.toggleDropdown = toggleDropdown;
window.newProject = newProject;
window.openProject = openProject;
window.saveProject = saveProject;
window.exportProject = exportProject;
window.applyReverb = applyReverb;
window.applyEcho = applyEcho;
window.analyzeFrequency = analyzeFrequency;
window.selectionTool = selectionTool;
window.envelopeTool = envelopeTool;
window.showAbout = showAbout;
window.cut = cut;
window.copy = copy;
window.paste = paste;
window.selectTrack = selectTrack;
window.updateTrackList = updateTrackList;

// Export variables to global scope
window.tracks = tracks;
window.selectedTrack = selectedTrack;
window.isRecording = isRecording;
window.isPlaying = isPlaying;
window.audioContext = audioContext;
window.wavesurfer = wavesurfer;
window.clipboard = clipboard;

function applyReverb() {
    console.log('Applying reverb...');
    if (!selectedTrack || !selectedTrack.audioBuffer) {
        alert('Please select a track with audio to apply reverb.');
        return;
    }

    const effect = {
        type: 'reverb',
        params: {
            time: 2.0,
            decay: 0.8
        }
    };

    selectedTrack.applyEffect(effect);
    updateUI();
}

function applyEcho() {
    console.log('Applying echo...');
    if (!selectedTrack || !selectedTrack.audioBuffer) {
        alert('Please select a track with audio to apply echo.');
        return;
    }

    const effect = {
        type: 'echo',
        params: {
            delay: 0.3,
            feedback: 0.5,
            mix: 0.5
        }
    };

    selectedTrack.applyEffect(effect);
    updateUI();
}

function analyzeFrequency() {
    console.log('Analyzing frequency...');
    if (!selectedTrack || !selectedTrack.audioBuffer) {
        alert('Please select a track with audio to analyze.');
        return;
    }
    
    // In a real implementation, this would perform frequency analysis
    alert('Frequency analysis would be implemented here.');
}

function toggleDropdown(menuId) {
    console.log('Toggling dropdown:', menuId);
    const menu = document.getElementById(menuId);
    
    if (!menu) {
        console.error('Menu not found:', menuId);
        return;
    }
    
    // Hide all other dropdowns
    document.querySelectorAll('.dropdown').forEach(m => {
        if (m.id !== menuId) {
            m.classList.remove('show');
        }
    });
    
    // Toggle the clicked menu
    menu.classList.toggle('show');
    
    // Stop event propagation
    event.stopPropagation();
}

// Add event listener to close dropdowns when clicking outside
document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-item')) {
        document.querySelectorAll('.dropdown').forEach(menu => {
            menu.classList.remove('show');
        });
    }
});

// Add this function to handle track selection
function toggleTrackSelection(trackId) {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
        // If the track is already selected, just unselect it
        if (track.isSelected) {
            track.isSelected = false;
        } else {
            // Unselect all other tracks first
            tracks.forEach(t => t.isSelected = false);
            // Then select this track
            track.isSelected = true;
        }
        updateTrackSelectionUI(track);
    }
}

// Add this function to update the selection UI
function updateTrackSelectionUI(track) {
    const trackElement = document.getElementById(`track-${track.id}`);
    if (trackElement) {
        const selectButton = trackElement.querySelector('.select-btn');
        if (selectButton) {
            selectButton.innerHTML = track.isSelected ? 
                '<i class="fas fa-check-square"></i> Unselect' : 
                '<i class="fas fa-square"></i> Select';
            selectButton.classList.toggle('active', track.isSelected);
        }
        trackElement.classList.toggle('selected', track.isSelected);
    }
}

// Add this function to get the currently selected track
function getSelectedTrack() {
    return tracks.find(track => track.isSelected);
}

function showAbout() {
    alert('Web Audio Editor - An Audacity-like web application.\n\nCreated with ❤️ and Web Audio API.');
}

// Helper: Convert AudioBuffer to WAV ArrayBuffer
function audioBufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels,
        length = buffer.length * numOfChan * 2 + 44,
        bufferArray = new ArrayBuffer(length),
        view = new DataView(bufferArray),
        channels = [],
        sampleRate = buffer.sampleRate;
    let offset = 0, pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(sampleRate);
    setUint32(sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4);

    // write interleaved data
    for (let i = 0; i < numOfChan; i++)
        channels.push(buffer.getChannelData(i));

    let sample = 0;
    while (offset < buffer.length) {
        for (let i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            sample = (0.5 + sample * 32767) | 0;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }

    return bufferArray;
} 