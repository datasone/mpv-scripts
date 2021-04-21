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
            print("DEBUG: " .. s)
        end
    end
end

ipc_socket_file = "\\\\.\\pipe\\mpvmcsocket"

function write_to_socket(message)
    _, pipe = pcall(io.open, ipc_socket_file, "w")
    if pipe then
        pcall(pipe.write, pipe, message)
        pcall(pipe.flush, pipe)
        pcall(pipe.close, pipe)
        debug_log(message)
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

function encode_element(str)
    return str:gsub("%(", "\\\\["):gsub("%)", "\\\\]")
end

function notify_current_file()
    metadata = mp.get_property_native("metadata")
    debug_log(metadata)
    if not metadata then
        return
    end

    artist = get_metadata(metadata, { "artist", "ARTIST", "Artist" })
    title = get_metadata(metadata, { "title", "TITLE", "Title", "icy-title" })

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
    end

    if not title or title == "" then
        title = mp.get_property_native("filename/no-ext")
    end

    path = mp.get_property_native("path")
    if path:sub(2, 3) ~= ":\\" and path:sub(2, 3) ~= ":/" then
        dir = mp.get_property_native("working-directory")
        path = dir + "\\" + path
    end

    if not artist then
        artist = ""
    end

    if title then
        title = encode_element(title)
    end
    if artist then
        artist = encode_element(artist)
    end
    path = encode_element(path)

    message_content = "^[setFile](title=" .. title .. ")(artist=" .. artist .. ")(path=" .. path .. ")$"
    write_to_socket(message_content)
end

function play_state_changed()
    idle = mp.get_property_native("core-idle")
    is_playing = not idle

    message_content = "^[setState](playing=" .. tostring(is_playing) .. ")$"
    write_to_socket(message_content)
    
    if not idle then
        mp.add_timeout(10, play_state_changed)
    end
end

function notify_metadata_updated()
    notify_current_file()
end

mp.register_event("file-loaded", notify_current_file)
mp.observe_property("metadata", nil, notify_metadata_updated)
mp.observe_property("chapter", nil, notify_metadata_updated)
mp.register_event("end-file", play_state_changed)
mp.observe_property("core-idle", nil, play_state_changed)

function on_quit()
    write_to_socket("^[setQuit](quit=true)$")
end

mp.register_event("shutdown", on_quit)
