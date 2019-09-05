-- notify.lua -- notifies LyricsX by using AppleScript.
-- This script requires a json parser (e.g. json.lua https://github.com/rxi/json.lua) to work in order to interpret chapter information.
--
-- Copyright (c) 2014 Roland Hieber
-- Copyright (c) 2019 datasone
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy
-- of this software and associated documentation files (the "Software"), to deal
-- in the Software without restriction, including without limitation the rights
-- to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
-- copies of the Software, and to permit persons to whom the Software is
-- furnished to do so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in
-- all copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.

-------------------------------------------------------------------------------
-- helper functions
-------------------------------------------------------------------------------

function string.starts(String,Start)
   return string.sub(String,1,string.len(Start))==Start
end

function print_debug(s)
	-- print("DEBUG: " .. s) -- comment out for no debug info
	return true
end

-------------------------------------------------------------------------------
-- here we go.
-------------------------------------------------------------------------------

json = require "json"

function notify_current_track()
	local data = mp.get_property_native("metadata")
	if not data then
		return
	end

	function get_metadata(data, keys)
		for _,v in pairs(keys) do
			if data[v] and string.len(data[v]) > 0 then
				return data[v]
			end
		end
		return ""
	end
	-- srsly MPV, why do we have to do this? :-(
	local artist = get_metadata(data, {"artist", "ARTIST"})
	local album = get_metadata(data, {"album", "ALBUM"})
	local album_mbid = get_metadata(data, {"MusicBrainz Album Id",
		"MUSICBRAINZ_ALBUMID"})
	local title = get_metadata(data, {"title", "TITLE", "icy-title"})

    if artist == "" or title == "" then
        local chapter = mp.get_property("chapter")
        local chapters = mp.get_property("chapter-list")
        if chapter and chapters then
            local tag = string.format("CUE_TRACK%02d_ARTIST", chapter + 1)
            local cue_artist = get_metadata(data, {tag})
            chapters = json.decode(chapters)
            local chapter_title = chapters[chapter + 1]["title"]
            if artist == "" then artist = cue_artist end
            if title == "" then title = chapter_title end
        end
    end

	print_debug("notify_current_track: relevant metadata:")
	print_debug("artist: " .. artist)
	print_debug("album: " .. album)
    print_debug("title: " .. title)
	print_debug("album_mbid: " .. album_mbid)

    local path = mp.get_property_native("path")

    print("path: " .. path)

    local fileURL = ""

    if string.starts(path, "/") then
        fileURL = "file://" .. path
    else
        local dir = mp.get_property_native("working-directory")
        fileURL = "file://" .. dir .. "/" .. path
    end

    local duration = mp.get_property_native("duration")

    local command = ("osascript -e 'tell application \"LyricsX\"' -e 'setTrack title \"%s\" album \"%s\" artist \"%s\" url \"%s\" duration %d' -e 'end tell'"):format(title, album, artist, fileURL, duration)

    print(command)

	os.execute(command)

end

function notify_metadata_updated(name, data)
	notify_current_track()
end

function play_pos_changed()
    
    local playback_time = mp.get_property_native("time-pos")

    local idle = mp.get_property_native("core-idle")
    local isPlaying = "with"
    if idle then isPlaying = "without" end

    if playback_time == nil then return end

    local command = ("osascript -e 'tell application \"LyricsX\"' -e 'setState position %d %s isPlaying' -e 'end tell'"):format(playback_time, isPlaying)

    print(command)

    os.execute(command)

end

function play_state_changed(name, data)
    play_pos_changed()
end

-- insert main() here

mp.register_event("file-loaded", notify_current_track)
mp.observe_property("metadata", nil, notify_metadata_updated)
mp.observe_property("chapter", nil, notify_metadata_updated)
mp.register_event("seek", play_pos_changed)
mp.register_event("end-file", play_pos_changed)
mp.observe_property("core-idle", nil, play_state_changed)
