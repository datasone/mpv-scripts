let net = require("net")
let msg = require("mp.msg")

const DEBUG = true;

function debugLog(message) {
    if (DEBUG)
        msg.log(message);
}

const isWindows = navigator.appVersion.indexOf("Win") != -1;

const ipcSocketFile = isWindows ? "\\\\.\\pipe\\clyricsocket" : "/tmp/clyricsocket";

let client = net.createConnection(ipcSocketFile);

let persistentOverlay = false;
let display = false;

let overlay = mp.create_osd_overlay("ass-events");

class Track {
    title: string;
    album: string;
    artist: string;

    constructor(title: string, album: string, artist: string) {
        this.title = title;
        this.album = album;
        this.artist = artist;
    }

    toString(): string {
        return `${(this.title)} - ${(this.artist)} - ${(this.album)}`;
    }

    encodedTrack(): Track {
        const encodedTitle = this.title.replace("\(", "\\\[").replace("\)", "\\\]");
        const encodedAlbum = this.album.replace("\(", "\\\[").replace("\)", "\\\]");
        const encodedArtist = this.artist.replace("\(", "\\\[").replace("\)", "\\\]");
        return new Track(encodedTitle, encodedAlbum, encodedArtist);
    }
}

let track: Track;

function osdMessage(message: string) {
    if (persistentOverlay) {
        overlay.data = `{\\fs12}${message}`;
        overlay.update();
    } else {
        let dispMessage = mp.get_property("osd-ass-cc/0") + "{\\fs12}" + mp.get_property("osd-ass-cc/1") + message;
        mp.osd_message(dispMessage);
    }
}

function clearScreen() {
    if (persistentOverlay)
        overlay.remove();
    else
        mp.osd_message("", 0);
}

function tempDisplay() {
    if (persistentOverlay) {
        if (display)
            clearScreen();
        persistentOverlay = false;
    }
    osdMessage(track.toString());
}

function togglePersistentDisplay() {
    if (persistentOverlay) {
        if (!display) {
            osdMessage(track.toString());
            display = true;
        } else {
            clearScreen();
            display = false;
        }
    } else {
        clearScreen();
        persistentOverlay = true;
        osdMessage(track.toString());
        display = true;
    }
}

function refreshOSD() {
    if (persistentOverlay && display) {
        clearScreen();
        osdMessage(track.toString())
    }
}

function getMetadata(data, keys) {
    for (let key in keys) {
        if (data[key] != null && data[key].length != 0)
            return data[key]
    }
    return ""
}

function notifyCurrentTrack() {
    const frameCount = mp.get_property_native("estimated-frame-count");
    if (frameCount == null || frameCount > 0)
        return null;

    const metadata = mp.get_property_native("metadata");
    if (metadata == null)
        return null;

    track.artist = getMetadata(metadata, ["artist", "ARTIST"]);
    track.album = getMetadata(metadata, ["album", "ALBUM", "CUE_TITLE"]);
    track.title = getMetadata(metadata, ["title", "TITLE", "icy-title"]);

    // @ts-ignore
    let duration: number = mp.get_property_native("duration");

    debugLog(mp.get_property_native("chapter-metadata"));

    if (track.artist == null || track.artist == "" || track.title == null || track.title == "") {
        const chapterMetadata = mp.get_property_native("chapter-metadata");

        if (chapterMetadata != null) {
            const chapterArtist = chapterMetadata["performer"];
            const chapterTitle = chapterMetadata["title"];
            if (track.artist == "")
                track.artist = chapterArtist;
            if (track.title == "")
                track.title = chapterTitle;
        }

        // @ts-ignore
        const chapter: number = mp.get_property_native("chapter");
        // @ts-ignore
        const chapterList: Array<any> = mp.get_property_native("chapter-list");

        if (chapter != null && chapterList != null && chapter >= 0) {
            if (chapter < chapterList.length - 1) {
                duration = chapterList[chapter + 2]["time"];
            } else {
                duration = duration - chapterList[chapter + 1]["time"];
            }
        }
    }

    if (track.title == "") {
        // @ts-ignore
        track.title = mp.get_property_native("filename/no-ext");
    }

    if (track.artist == null || track.title == null || track.album == null)
        return null;

    debugLog("notify_current_track: relevant metadata:");
    debugLog(`artist: ${track.artist}`);
    debugLog(`album: ${track.album}`);
    debugLog(`title: ${track.title}`);

    // @ts-ignore
    const path: string = mp.get_property_native("path");
    let fileURL = "";

    if (path.startsWith("/"))
        fileURL = `file://${path}`;
    else {
        const dir = mp.get_property_native("working-directory");
        fileURL = `file://${dir}/${path}`;
    }

    const encodedTrack = track.encodedTrack();
    const messageContent = `^[setTrack](title=${encodedTrack.title})(album=${encodedTrack.album})(artist=${encodedTrack.artist})(duration=${duration})$`

    try {
        client.write(messageContent);
    } catch (e) {
        console.log(e.stackTrace)
    }
    refreshOSD();
}

function playPosChanged() {
    const frameCount = mp.get_property_native("estimated-frame-count");
    if (frameCount != null || frameCount > 0)
        return null;

    // @ts-ignore
    let playbackTime: number = mp.get_property_native("time-pos");
    if (playbackTime == null)
        return null;

    // @ts-ignore
    const chapter: number = mp.get_property_native("chapter");
    const chapterList = mp.get_property_native("chapter-list");
    if (chapter != null && chapterList != null && chapter > 0) {
        playbackTime = playbackTime - chapterList[chapter + 1]["time"];
    }

    const idle = mp.get_property_native("core-idle");
    const isPlaying = idle ? "false" : "true";

    const messageContent = `^[setState](playing=${isPlaying})(position=${playbackTime * 1000})`;
    client.write(messageContent);

    if (!idle)
        setTimeout(playPosChanged, 10000);
}

let notifyMetadataUpdated = notifyCurrentTrack;
let playStateChanged = playPosChanged;

mp.register_event("file-loaded", notifyCurrentTrack);
mp.observe_property("metadata", null, notifyMetadataUpdated);
mp.observe_property("chapter", null, notifyMetadataUpdated);
mp.register_event("seek", playPosChanged);
mp.register_event("end-file", playPosChanged);
mp.observe_property("core-idle", null, playStateChanged);

mp.add_key_binding("c", "show-metadata-osd", tempDisplay);
mp.add_key_binding("C", "show-metadata-persistent-osd", togglePersistentDisplay);