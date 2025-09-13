export const mockTimelineData = {
    tracks: [
        {
            id: "video-track-1",
            type: "video",
            clips: [
                { id: "clip-1", name: "Intro.mp4", start: 0, duration: 10 },
                { id: "clip-2", name: "Scene1.mp4", start: 12, duration: 20 },
            ],
        },
        {
            id: "audio-track-1",
            type: "audio",
            clips: [{ id: "clip-3", name: "Music.mp3", start: 0, duration: 30 }],
        },
        {
            id: "subtitle-track-1",
            type: "subtitle",
            clips: [{ id: "clip-4", name: "Subtitles.srt", start: 5, duration: 15 }],
        },
    ],
};

export const mockResources = {
    Danmakus: [
        { id: "v1", name: "Intro.mp4", duration: "00:10", size: "25.4 MB" },
        { id: "v2", name: "Scene1.mp4", duration: "00:20", size: "48.2 MB" },
        { id: "v3", name: "Outro.mp4", duration: "00:08", size: "19.8 MB" },
    ],
    audio: [
        {
            id: "a1",
            name: "Background Music.mp3",
            duration: "03:45",
            size: "8.7 MB",
        },
        { id: "a2", name: "Voice Over.wav", duration: "01:30", size: "15.2 MB" },
    ],
    images: [
        { id: "i1", name: "Logo.png", size: "2.1 MB" },
        { id: "i2", name: "Thumbnail.jpg", size: "1.8 MB" },
    ],
    documents: [
        { id: "d1", name: "Script.txt", size: "12 KB" },
        { id: "d2", name: "Notes.md", size: "8 KB" },
    ],
};