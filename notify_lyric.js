var net = require("net");
var msg = require("mp.msg");
var DEBUG = true;
function debugLog(message) {
    if (DEBUG)
        msg.log(message);
}
var isWindows = navigator.appVersion.indexOf("Win") != -1;
var ipcSocketFile = isWindows ? "\\\\.\\pipe\\clyricsocket" : "/tmp/clyricsocket";
var client = net.createConnection(ipcSocketFile);
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
var track;
function osdMessage(message) {
    if (persistentOverlay) {
        overlay.data = "{\\fs12}" + message;
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
    for (var key in keys) {
        if (data[key] != null && data[key].length != 0)
            return data[key];
    }
    return "";
}
function notifyCurrentTrack() {
    var frameCount = mp.get_property_native("estimated-frame-count");
    if (frameCount == null || frameCount > 0)
        return null;
    var metadata = mp.get_property_native("metadata");
    if (metadata == null)
        return null;
    track.artist = getMetadata(metadata, ["artist", "ARTIST"]);
    track.album = getMetadata(metadata, ["album", "ALBUM", "CUE_TITLE"]);
    track.title = getMetadata(metadata, ["title", "TITLE", "icy-title"]);
    // @ts-ignore
    var duration = mp.get_property_native("duration");
    debugLog(mp.get_property_native("chapter-metadata"));
    if (track.artist == null || track.artist == "" || track.title == null || track.title == "") {
        var chapterMetadata = mp.get_property_native("chapter-metadata");
        if (chapterMetadata != null) {
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
        if (chapter != null && chapterList != null && chapter >= 0) {
            if (chapter < chapterList.length - 1) {
                duration = chapterList[chapter + 2]["time"];
            }
            else {
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
    debugLog("artist: " + track.artist);
    debugLog("album: " + track.album);
    debugLog("title: " + track.title);
    // @ts-ignore
    var path = mp.get_property_native("path");
    var fileURL = "";
    if (path.startsWith("/"))
        fileURL = "file://" + path;
    else {
        var dir = mp.get_property_native("working-directory");
        fileURL = "file://" + dir + "/" + path;
    }
    var encodedTrack = track.encodedTrack();
    var messageContent = "^[setTrack](title=" + encodedTrack.title + ")(album=" + encodedTrack.album + ")(artist=" + encodedTrack.artist + ")(duration=" + duration + ")$";
    try {
        client.write(messageContent);
    }
    catch (e) {
        console.log(e.stackTrace);
    }
    refreshOSD();
}
function playPosChanged() {
    var frameCount = mp.get_property_native("estimated-frame-count");
    if (frameCount != null || frameCount > 0)
        return null;
    // @ts-ignore
    var playbackTime = mp.get_property_native("time-pos");
    if (playbackTime == null)
        return null;
    // @ts-ignore
    var chapter = mp.get_property_native("chapter");
    var chapterList = mp.get_property_native("chapter-list");
    if (chapter != null && chapterList != null && chapter > 0) {
        playbackTime = playbackTime - chapterList[chapter + 1]["time"];
    }
    var idle = mp.get_property_native("core-idle");
    var isPlaying = idle ? "false" : "true";
    var messageContent = "^[setState](playing=" + isPlaying + ")(position=" + playbackTime * 1000 + ")";
    client.write(messageContent);
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
