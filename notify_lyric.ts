const DEBUG = false;

function debugLog(message) {
    if (DEBUG) {
        if (typeof message == "object")
            message = JSON.stringify(message, null, 4);
        mp.msg.info(message);
    }
}

function checkIsVideo(): boolean {
    const frameCount = mp.get_property_native("estimated-frame-count");
    debugLog(frameCount);
    if (frameCount == undefined || frameCount > 0) {
        // @ts-ignore
        const currentVideoTrackFileName: string = mp.get_property_native("current-tracks/video/external-filename")
        debugLog(currentVideoTrackFileName);
        if (!currentVideoTrackFileName)
            return true;
        const splitFileName = currentVideoTrackFileName.split(".");
        const extName = splitFileName[splitFileName.length - 1];
        debugLog(extName);
        if (extName !in ["jpg", "png", "gif", "JPG", "PNG", "GIF"])
            return true;
    }
    return false;
}

const cwdPath = mp.utils.getcwd();
const isWindows = cwdPath.charAt(0) != '/';

const ipcSocketFile = isWindows ? "\\\\.\\pipe\\clyricsocket" : "/tmp/clyricsocket";

const socatRes = mp.command_native({
    name: "subprocess",
    args: [
        "socat"
    ]
});

let socatAvail = socatRes == 0;

if (!isWindows && !socatAvail)
    mp.msg.error("Please install socat for Unix systems.");

function writeToSocket(message: string) {
    if (isWindows) {
        for (let specialChar of ['&', '\\', '<', '>', '^', '|'])
            message = message.replace(specialChar, `^${specialChar}`);
        mp.command_native_async({
            name: "subprocess",
            args: [
                "C:\\Windows\\System32\\cmd",
                "/C",
                `echo ${message} > ${ipcSocketFile}`
            ]
        });
        debugLog([
            "C:\\Windows\\System32\\cmd",
            "/C",
            `echo '${message}' > ${ipcSocketFile}`
        ].join(" "));
    } else {
        if (socatAvail) {
            message.replace('\'', "\\\'");
            mp.command_native_async({
                name: "subprocess",
                args: [
                    "/bin/bash",
                    "-c",
                    `echo '${message}' | socat - ${ipcSocketFile}`
                ]
            });
            debugLog([
                "/bin/bash",
                "-c",
                `echo '${message}' | socat - ${ipcSocketFile}`
            ].join(" "));
        }
    }
}

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

let track = new Track(undefined, undefined, undefined);

function osdMessage(message: string) {
    if (persistentOverlay) {
        overlay.data = message;
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

function getMetadata(data: object, keys: Array<string>): string {
    for (let key of keys) {
        if (data[key] && data[key].length != 0)
            return data[key];
    }
    return ""
}

function notifyCurrentTrack() {
    if (checkIsVideo())
        return null;

    // @ts-ignore
    const metadata: object = mp.get_property_native("metadata");
    debugLog(metadata);
    if (!metadata)
        return null;

    track.artist = getMetadata(metadata, ["artist", "ARTIST", "Artist"]);
    track.album = getMetadata(metadata, ["album", "ALBUM", "Album", "CUE_TITLE"]);
    track.title = getMetadata(metadata, ["title", "TITLE", "Title", "icy-title"]);

    // @ts-ignore
    let duration: number = mp.get_property_native("duration");

    // debugLog(mp.get_property_native("chapter-metadata"));

    if (!track.artist || track.artist == "" || !track.title || track.title == "") {
        const chapterMetadata = mp.get_property_native("chapter-metadata");

        if (chapterMetadata) {
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

        if (chapter && chapterList && chapter >= 0) {
            if (chapter < chapterList.length - 1) {
                duration = chapterList[chapter + 1]["time"];
            } else {
                duration = duration - chapterList[chapter]["time"];
            }
        }
    }

    if (track.title == "") {
        // @ts-ignore
        track.title = mp.get_property_native("filename/no-ext");
    }

    if (!track.artist || !track.title || !track.album)
        return null;

    debugLog("notify_current_track: relevant metadata:");
    debugLog(`artist: ${track.artist}`);
    debugLog(`album: ${track.album}`);
    debugLog(`title: ${track.title}`);

    // @ts-ignore
    // const path: string = mp.get_property_native("path");
    // let fileURL = "";
    //
    // if (path && path.startsWith("/"))
    //     fileURL = `file://${path}`;
    // else {
    //     const dir = mp.get_property_native("working-directory");
    //     fileURL = `file://${dir}/${path}`;
    // }

    const encodedTrack = track.encodedTrack();
    const messageContent = `^[setTrack](title=${encodedTrack.title})(album=${encodedTrack.album})(artist=${encodedTrack.artist})(duration=${Math.round(duration)})$`

    try {
        writeToSocket(messageContent);
    } catch (e) {
        console.log(e.stackTrace)
    }
    refreshOSD();
}

function playPosChanged() {
    if (checkIsVideo())
        return null;

    // @ts-ignore
    let playbackTime: number = mp.get_property_native("time-pos");
    debugLog(playbackTime)
    if (!playbackTime)
        return null;

    // @ts-ignore
    const chapter: number = mp.get_property_native("chapter");
    const chapterList = mp.get_property_native("chapter-list");
    if (chapter && chapterList && chapter > 0) {
        playbackTime = playbackTime - chapterList[chapter]["time"];
    }

    const idle = mp.get_property_native("core-idle");
    const isPlaying = idle ? "false" : "true";

    const messageContent = `^[setState](playing=${isPlaying})(position=${Math.round(playbackTime) * 1000})$`;
    writeToSocket(messageContent);

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