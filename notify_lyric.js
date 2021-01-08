var DEBUG = false;
function debugLog(message) {
    if (DEBUG) {
        if (typeof message == "object")
            message = JSON.stringify(message, null, 4);
        mp.msg.info(message);
    }
}
function checkIsVideo() {
    var frameCount = mp.get_property_native("estimated-frame-count");
    debugLog(frameCount);
    if (frameCount == undefined || frameCount > 0) {
        // @ts-ignore
        var currentVideoTrackFileName = mp.get_property_native("current-tracks/video/external-filename");
        debugLog(currentVideoTrackFileName);
        if (!currentVideoTrackFileName)
            return true;
        var splitFileName = currentVideoTrackFileName.split(".");
        var extName = splitFileName[splitFileName.length - 1];
        debugLog(extName);
        if (extName in ["jpg", "png", "gif", "JPG", "PNG", "GIF"])
            return true;
    }
    return false;
}
var cwdPath = mp.utils.getcwd();
var isWindows = cwdPath.charAt(0) != '/';
var ipcSocketFile = isWindows ? "\\\\.\\pipe\\clyricsocket" : "/tmp/clyricsocket";
var socatRes = mp.command_native({
    name: "subprocess",
    args: [
        "socat"
    ]
});
var socatAvail = socatRes == 0;
if (!isWindows && !socatAvail)
    mp.msg.error("Please install socat for Unix systems.");
function writeToSocket(message) {
    if (isWindows) {
        for (var _i = 0, _a = ['&', '\\', '<', '>', '^', '|']; _i < _a.length; _i++) {
            var specialChar = _a[_i];
            message = message.replace(specialChar, "^" + specialChar);
        }
        mp.command_native_async({
            name: "subprocess",
            args: [
                "C:\\Windows\\System32\\cmd",
                "/C",
                "echo " + message + " > " + ipcSocketFile
            ]
        });
        debugLog([
            "C:\\Windows\\System32\\cmd",
            "/C",
            "echo '" + message + "' > " + ipcSocketFile
        ].join(" "));
    }
    else {
        if (socatAvail) {
            message.replace('\'', "\\\'");
            mp.command_native_async({
                name: "subprocess",
                args: [
                    "/bin/bash",
                    "-c",
                    "echo '" + message + "' | socat - " + ipcSocketFile
                ]
            });
            debugLog([
                "/bin/bash",
                "-c",
                "echo '" + message + "' | socat - " + ipcSocketFile
            ].join(" "));
        }
    }
}
var persistentOverlay = false;
var display = false;
var overlay = mp.create_osd_overlay("ass-events");
var Track = /** @class */ (function () {
    function Track(title, album, artist) {
        this.title = title;
        this.album = album;
        this.artist = artist;
    }
    Track.prototype.toString = function () {
        return (this.title) + " - " + (this.artist) + " - " + (this.album);
    };
    Track.prototype.encodedTrack = function () {
        var encodedTitle = this.title.replace("\(", "\\\[").replace("\)", "\\\]");
        var encodedAlbum = this.album.replace("\(", "\\\[").replace("\)", "\\\]");
        var encodedArtist = this.artist.replace("\(", "\\\[").replace("\)", "\\\]");
        return new Track(encodedTitle, encodedAlbum, encodedArtist);
    };
    return Track;
}());
var track = new Track(undefined, undefined, undefined);
function osdMessage(message) {
    if (persistentOverlay) {
        overlay.data = message;
        overlay.update();
    }
    else {
        var dispMessage = mp.get_property("osd-ass-cc/0") + "{\\fs12}" + mp.get_property("osd-ass-cc/1") + message;
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
        }
        else {
            clearScreen();
            display = false;
        }
    }
    else {
        clearScreen();
        persistentOverlay = true;
        osdMessage(track.toString());
        display = true;
    }
}
function refreshOSD() {
    if (persistentOverlay && display) {
        clearScreen();
        osdMessage(track.toString());
    }
}
function getMetadata(data, keys) {
    for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
        var key = keys_1[_i];
        if (data[key] && data[key].length != 0)
            return data[key];
    }
    return "";
}
function notifyCurrentTrack() {
    if (checkIsVideo())
        return null;
    // @ts-ignore
    var metadata = mp.get_property_native("metadata");
    debugLog(metadata);
    if (!metadata)
        return null;
    track.artist = getMetadata(metadata, ["artist", "ARTIST", "Artist"]);
    track.album = getMetadata(metadata, ["album", "ALBUM", "Album", "CUE_TITLE"]);
    track.title = getMetadata(metadata, ["title", "TITLE", "Title", "icy-title"]);
    // @ts-ignore
    var duration = mp.get_property_native("duration");
    // debugLog(mp.get_property_native("chapter-metadata"));
    if (!track.artist || track.artist == "" || !track.title || track.title == "") {
        var chapterMetadata = mp.get_property_native("chapter-metadata");
        if (chapterMetadata) {
            var chapterArtist = chapterMetadata["performer"];
            var chapterTitle = chapterMetadata["title"];
            if (track.artist == "")
                track.artist = chapterArtist;
            if (track.title == "")
                track.title = chapterTitle;
        }
        // @ts-ignore
        var chapter = mp.get_property_native("chapter");
        // @ts-ignore
        var chapterList = mp.get_property_native("chapter-list");
        if (chapter && chapterList && chapter >= 0) {
            if (chapter < chapterList.length - 1) {
                duration = chapterList[chapter + 1]["time"];
            }
            else {
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
    debugLog("artist: " + track.artist);
    debugLog("album: " + track.album);
    debugLog("title: " + track.title);
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
    var encodedTrack = track.encodedTrack();
    var messageContent = "^[setTrack](title=" + encodedTrack.title + ")(album=" + encodedTrack.album + ")(artist=" + encodedTrack.artist + ")(duration=" + Math.round(duration) + ")$";
    try {
        writeToSocket(messageContent);
    }
    catch (e) {
        console.log(e.stackTrace);
    }
    refreshOSD();
}
function playPosChanged() {
    if (checkIsVideo())
        return null;
    // @ts-ignore
    var playbackTime = mp.get_property_native("time-pos");
    debugLog(playbackTime);
    if (!playbackTime)
        return null;
    // @ts-ignore
    var chapter = mp.get_property_native("chapter");
    var chapterList = mp.get_property_native("chapter-list");
    if (chapter && chapterList && chapter > 0) {
        playbackTime = playbackTime - chapterList[chapter]["time"];
    }
    var idle = mp.get_property_native("core-idle");
    var isPlaying = idle ? "false" : "true";
    var messageContent = "^[setState](playing=" + isPlaying + ")(position=" + Math.round(playbackTime) * 1000 + ")$";
    writeToSocket(messageContent);
    if (!idle)
        setTimeout(playPosChanged, 10000);
}
var notifyMetadataUpdated = notifyCurrentTrack;
var playStateChanged = playPosChanged;
mp.register_event("file-loaded", notifyCurrentTrack);
mp.observe_property("metadata", null, notifyMetadataUpdated);
mp.observe_property("chapter", null, notifyMetadataUpdated);
mp.register_event("seek", playPosChanged);
mp.register_event("end-file", playPosChanged);
mp.observe_property("core-idle", null, playStateChanged);
mp.add_key_binding("c", "show-metadata-osd", tempDisplay);
mp.add_key_binding("C", "show-metadata-persistent-osd", togglePersistentDisplay);
