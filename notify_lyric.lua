DEBUG = false

-- Print contents of `tbl`, with indentation.
-- `indent` sets the initial level of indentation.
function tprint (tbl, indent)
    if not indent then indent = 0 end
        for k, v in pairs(tbl) do
            formatting = string.rep("  ", indent) .. k .. ": "
        if type(v) == "table" then
            print(formatting)
            tprint(v, indent+1)
        elseif type(v) == 'boolean' then
            print(formatting .. tostring(v))      
        else
            print(formatting .. v)
        end
    end
end

function debug_log(message)
    if DEBUG then
        if not message then
            print("DEBUG: nil")
            return
        end
        if "table" == type(message) then
            print("DEBUG: ")
            tprint(message)
        else
            print("DEBUG: " .. message)
        end
    end
end

function has_value (tab, val)
    for index, value in ipairs(tab) do
        -- We grab the first index of our sub-table instead
        if value[1] == val then
            return true
        end
    end

    return false
end

function is_video()
    frame_count = mp.get_property_native("estimated-frame-count")
    debug_log(frame_count)
    if frame_count and frame_count > 0 then
        video_track_filename = mp.get_property_native("current-tracks/video/external-filename")
        debug_log(video_track_filename)
        if not video_track_filename then
            return true
        end
        ext_name = video_track_filename:match("^.+(%..+)$")
        debug_log(ext_name)
        image_exts = { "jpg", "png", "gif", "JPG", "PNG", "GIF" }
        if has_value(image_exts, ext_name) then
            return true
        end
    end
    return false
end

is_Windows = false

path_seperator = package.config:sub(1,1)
if path_seperator == '\\' then
    is_Windows = true
end

if is_Windows then
    ipc_socket_file = "\\\\.\\pipe\\clyricsocket"
else
    ipc_socket_file = "/tmp/clyricsocket"

    socat_avail = false

    if os.execute("socat") then
        socat_avail = true
    else
        print("Please install socat for Unix systems.")
    end
end

function write_to_socket(message)
    if (is_Windows) then
        _, pipe = pcall(io.open, ipc_socket_file, "w")
        if pipe then
            pcall(pipe.write, pipe, message)
            pcall(pipe.flush, pipe)
            pcall(pipe.close, pipe)
            debug_log(message)
        end
    else
        if (socat_avail) then
            message = message:gsub("'", "'\\''")
            command = "echo '" .. message .. "' | socat - " .. ipc_socket_file
            pcall(os.execute, command)
            debug_log(command)
        end
    end
end

persistent_overlay = false
display = false

overlay = mp.create_osd_overlay("ass-events")

title = ""
artist = ""
album = ""

function track_to_string(title, artist, album)
    return title .. " - " .. artist .. " - " .. album
end

function encode_element(str)
    return str:gsub("%(", "\\\\["):gsub("%)", "\\\\]")
end

function osd_message(message)
    if persistent_overlay then
        overlay.data = message
        overlay:update();
    else
        disp_message = mp.get_property("osd-ass-cc/0") .. "{\\fs12}" .. mp.get_property("osd-ass-cc/1") .. message
        mp.osd_message(disp_message)
    end
end

function clear_screen()
    if persistent_overlay then
        overlay:remove()
    else
        mp.osd_message("", 0)
    end
end

function temp_display()
    if persistent_overlay then
        if display then
            clear_screen()
        end
        persistent_overlay = false
    end
    osd_message(track_to_string(title, artist, album))
end

function toggle_persistent_display()
    if persistent_overlay then
        if not display then
            osd_message(track_to_string(title, artist, album))
            display = true
        else
            clear_screen()
            display = false
        end
    else
        clear_screen()
        persistent_overlay = true
        osd_message(track_to_string(title, artist, album))
        display = true
    end
end

function refresh_osd()
    if persistent_overlay and display then
        clear_screen()
        osd_message(track_to_string(title, artist, album))
    end
end

function get_metadata(data, keys)
    for _, v in pairs(keys) do
        if data[v] and string.len(data[v]) > 0 then
            return data[v]
        end
    end
    return ""
end

function notify_current_track()
    if is_video() then
        return
    end

    metadata = mp.get_property_native("metadata")
    debug_log(metadata)
    if not metadata then
        return
    end

    artist = get_metadata(metadata, { "artist", "ARTIST", "Artist" })
    album = get_metadata(metadata, { "album", "ALBUM", "Album", "CUE_TITLE" })
    title = get_metadata(metadata, { "title", "TITLE", "Title", "icy-title" })

    duration = mp.get_property_native("duration")

    if not artist or artist == "" or not title or title == "" then
        chapter_metadata = mp.get_property_native("chapter-metadata")

        if chapter_metadata then
            chapter_artist = chapter_metadata["performer"]
            if not artist or artist == "" then
                artist = chapter_artist
            end

            chapter_title = chapter_metadata["title"]
            if not title or title == "" then
                title = chapter_title
            end
        end

        chapter_no = mp.get_property_native("chapter")
        chapter_list = mp.get_property_native("chapter-list")

        if chapter_no and chapter_list then
            if chapter_no < 0 then
                return
            end
            if chapter_no < #chapter_list - 1 then
                duration = chapter_list[chapter_no + 2]["time"] - chapter_list[chapter_no + 1]["time"]
            else
                duration = duration - chapter_list[chapter_no + 1]["time"]
            end
        end
    end

    if not title or title == "" then
        title = mp.get_property_native("filename/no-ext")
    end

    if not artist then
        artist = ""
    end

    if (not artist) or (not title) or (not album) then
        return
    end

    debug_log("notify_current_track: relevant metadata:")
    debug_log("artist: " .. artist)
    debug_log("album: " .. album)
    debug_log("title: " .. title)

    encoded_artist = encode_element(artist)
    encoded_album = encode_element(album)
    encoded_title = encode_element(title)

    message_content = "^[setTrack](title=" .. encoded_title .. ")(album=" .. encoded_album .. ")(artist=" .. encoded_artist .. ")(duration=" .. math.floor(duration + 0.5) .. ")$"

    write_to_socket(message_content)
    refresh_osd()
end

function play_pos_changed()
    if is_video() then
        return
    end

    playback_time = mp.get_property_native("time-pos")
    debug_log(playback_time)

    if not playback_time then
        return
    end

    chapter_no = mp.get_property_native("chapter")
    chapter_list = mp.get_property_native("chapter-list")

    if chapter and chapter_list then
        playback_time = playback_time - chapter_list[chapter_no + 1]["time"]
    end

    idle = mp.get_property_native("core-idle")
    is_playing = not idle

    message_content = "^[setState](playing=" .. tostring(is_playing) .. ")(position=" .. math.floor(playback_time + 0.5) * 1000 .. ")$"

    write_to_socket(message_content)

    if not idle then
        mp.add_timeout(10, play_pos_changed)
    end
end

function notify_metadata_updated()
    notify_current_track()
end

function play_state_changed()
    play_pos_changed()
end

mp.register_event("file-loaded", notify_current_track)
mp.observe_property("metadata", nil, notify_metadata_updated)
mp.observe_property("chapter", nil, notify_metadata_updated)
mp.register_event("seek", play_pos_changed)
mp.register_event("end-file", play_pos_changed)
mp.observe_property("core-idle", nil, play_state_changed)

mp.add_key_binding("c", "show-metadata-osd", temp_display)
mp.add_key_binding("C", "show-metadata-persistent-osd", toggle_persistent_display)

function on_quit()
    write_to_socket("^[setQuit](quit=true)$")
end

mp.register_event("shutdown", on_quit)
