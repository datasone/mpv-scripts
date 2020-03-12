-- notify.lua -- notifies LyricsX by using AppleScript.
-- This script requires a json parser (e.g. json.lua https://github.com/rxi/json.lua) to work in order to interpret chapter information.
--
-- Copyright (c) 2014 Roland Hieber
-- Copyright (c) 2020 datasone
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

OS_WINDOWS = false

path_seperator = package.config:sub(1,1)
if path_seperator == '\\' then
    OS_WINDOWS = true
end

if OS_WINDOWS then
    ipcSocketFile = "\\\\.\\pipe\\clyricsocket"
else
    ipcSocketFile = "/tmp/clyricsocket"
end

-------------------------------------------------------------------------------
-- here we go.
-------------------------------------------------------------------------------

persistent_overlay = false
display = false

function print_message(message)
    if persistent_overlay then
        mp.set_osd_ass(0, 0, "{\\fs12}" .. message)
    else
        mp.osd_message(message)
    end
end

function clear_screen()
    if persistent_overlay then mp.set_osd_ass(0, 0, "") else mp.osd_message("", 0) end
end

function temp_display()
    if persistent_overlay then
        if display then
            clear_screen()
        end
        persistent_overlay = false
    end
    print_message(("%s - %s - %s"):format(title, artist, album))
end

function toggle_persistent_display()
    if persistent_overlay then
        if not display then
            print_message(("%s - %s - %s"):format(title, artist, album))
            display = true
        else
            clear_screen()
            display = false
        end
    else
        clear_screen()
        persistent_overlay = true
        print_message(("%s - %s - %s"):format(title, artist, album))
        display = true
    end
end

function refresh_osd()
    if persistent_overlay and display then
        clear_screen()
        print_message(("%s - %s - %s"):format(title, artist, album))
    end
end


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
	artist = get_metadata(data, {"artist", "ARTIST"})
	album = get_metadata(data, {"album", "ALBUM", "CUE_TITLE"})
	local album_mbid = get_metadata(data, {"MusicBrainz Album Id",
		"MUSICBRAINZ_ALBUMID"})
	title = get_metadata(data, {"title", "TITLE", "icy-title"})
    duration = mp.get_property_native("duration")

    if artist == "" or title == "" then
        local chapter_metadata = mp.get_property_native("chapter-metadata")
        if chapter_metadata then
            local chapter_artist = chapter_metadata["performer"]
            local chapter_title = chapter_metadata["title"]
            if artist == "" then artist = chapter_artist end
            if title == "" then title = chapter_title end
        end
        local chapter = mp.get_property_native("chapter")
        local chapters = mp.get_property_native("chapter-list")
        if chapter and chapters then
            if chapter < #chapters - 1 then
                duration = chapters[chapter + 2]["time"] - chapters[chapter + 1]["time"]
            else
                duration = duration - chapters[chapter + 1]["time"]
            end
        end
    end

	print_debug("notify_current_track: relevant metadata:")
	print_debug("artist: " .. artist)
	print_debug("album: " .. album)
    print_debug("title: " .. title)
	print_debug("album_mbid: " .. album_mbid)

    local path = mp.get_property_native("path")

    local fileURL = ""

    if string.starts(path, "/") then
        fileURL = "file://" .. path
    else
        local dir = mp.get_property_native("working-directory")
        fileURL = "file://" .. dir .. "/" .. path
    end

    local messageContent = ("^[setTrack](title=%s)(album=%s)(artist=%s)(duration=%d)$"):format(title, album, artist, duration)

    _, f = pcall(io.open, ipcSocketFile, "a")
    pcall(io.output, f)
    pcall(io.write, messageContent)
    pcall(io.close, f)

    refresh_osd()

end

function notify_metadata_updated(name, data)
	notify_current_track()
end

function play_pos_changed()
    
    local playback_time = mp.get_property_native("time-pos")

    local chapter = mp.get_property_native("chapter")
    local chapters = mp.get_property_native("chapter-list")

    if chapter and chapters then
        playback_time = playback_time - chapters[chapter + 1]["time"]
    end

    local idle = mp.get_property_native("core-idle")
    local isPlaying = "true"
    if idle then isPlaying = "false" end

    if playback_time == nil then return end

    local messageContent = ("^[setState](playing=%s)(position=%d)$"):format(isPlaying, playback_time * 1000)
   
    _, f = pcall(io.open, ipcSocketFile, "a")
    pcall(io.output, f)
    pcall(io.write, messageContent)
    pcall(io.close, f)

    if not idle then
        mp.add_timeout(10, play_pos_changed)
    end

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

mp.add_key_binding("c", "show-metadata-osd", temp_display)
mp.add_key_binding("C", "show-metadata-persistent-osd", toggle_persistent_display)
