# projects/app.py - Modified for Notes File Persistence & No Deletion

# Standard library imports
import logging
import json
import os
import re # Import regex for sanitization
import subprocess
import socket
import atexit
import sys
import signal
import shlex
# import glob # No longer needed
# import markdown # No longer needed

# Third-party imports
from flask import (
    Flask, render_template, request, jsonify, send_file,
    flash, redirect, url_for, Response
)
# from werkzeug.utils import secure_filename # Potentially unused

# --- Configuration ---
UPLOAD_FOLDER = 'uploads' # Kept for potential future use
NOTES_DIR = 'notes_data' # Directory for notes files

# Initial port for the main terminal
_initial_ttyd_port = 7681
# Range for dynamically added terminals
_next_ttyd_port = 7682
_max_ttyd_port = 7781
# External dependencies
TTYD_COMMAND = 'ttyd'
TMUX_COMMAND = 'tmux'

# --- Flask App Setup ---
app = Flask(__name__)
app.secret_key = 'your_strong_random_secret_key_here' # <<< MUST CHANGE FOR PRODUCTION!
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(NOTES_DIR, exist_ok=True) # Ensure notes directory exists

# Basic logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# --- Terminal Process Management State ---
_running_ttyd_processes = {}
_running_tmux_sessions = {}

# --- Terminal Helper Functions ---
def is_port_in_use(port):
    """Checks if a TCP port is likely in use on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return False
        except OSError:
            return True

def find_available_port(start_port, max_port):
    """Finds the next available port in a given range."""
    port = start_port
    while port <= max_port:
        if not is_port_in_use(port):
             app.logger.info(f"Port {port} appears free.")
             return port
        app.logger.warning(f"Port {port} seems occupied, trying next.")
        port += 1
    app.logger.error(f"No available port found in range {start_port}-{max_port}")
    return None

def start_ttyd_process(port, initial_terminal=False):
    """Starts a ttyd process attached to a new tmux session."""
    if port in _running_ttyd_processes:
        app.logger.warning(f"ttyd already tracked for port {port}. Aborting start.")
        return None
    if is_port_in_use(port):
        app.logger.error(f"Port {port} is already in use. Cannot start ttyd.")
        return None

    session_name = f'cmd_wave_term_{port}'
    ttyd_cmd = [TTYD_COMMAND, '-p', str(port), '-W', TMUX_COMMAND, 'new', '-s', session_name]
    try:
        app.logger.info(f"Attempting: {' '.join(ttyd_cmd)}")
        process = subprocess.Popen(ttyd_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _running_ttyd_processes[port] = process
        _running_tmux_sessions[port] = session_name
        app.logger.info(f"Started ttyd (PID: {process.pid}) <-> tmux '{session_name}' on port {port}")
        return process
    except FileNotFoundError:
        app.logger.error(f"'{TTYD_COMMAND}' or '{TMUX_COMMAND}' not found. Ensure they are installed and in PATH.")
    except Exception as e:
        app.logger.error(f"Failed to start ttyd process on port {port}: {e}", exc_info=True)

    if port in _running_ttyd_processes: del _running_ttyd_processes[port]
    if port in _running_tmux_sessions: del _running_tmux_sessions[port]
    return None

# Modified cleanup_single_terminal to NOT remove notes file
def cleanup_single_terminal(port):
    """Cleans up ttyd and tmux processes for a specific port (DOES NOT DELETE NOTES)."""
    cleaned = False
    session_name = _running_tmux_sessions.pop(port, None)
    if session_name:
        try:
             app.logger.info(f"Attempting to kill tmux session: {session_name} for port {port}")
             kill_cmd = [TMUX_COMMAND, 'kill-session', '-t', session_name]
             subprocess.run(kill_cmd, timeout=2, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
             app.logger.info(f"Sent kill command to tmux session: {session_name}")
             cleaned = True
        except Exception as e:
             app.logger.error(f"Error killing tmux session {session_name}: {e}")

    process = _running_ttyd_processes.pop(port, None)
    if process and process.poll() is None:
        try:
             app.logger.info(f"Terminating ttyd process on port {port} (PID: {process.pid})")
             process.terminate()
             process.wait(timeout=1)
             cleaned = True
        except subprocess.TimeoutExpired:
             app.logger.warning(f"ttyd process {process.pid} did not terminate gracefully, killing.")
             process.kill()
             try: process.wait(timeout=1); cleaned = True
             except Exception as e_kill: app.logger.error(f"Error waiting for ttyd kill {process.pid}: {e_kill}")
        except Exception as e:
             app.logger.error(f"Error terminating/killing ttyd process {process.pid}: {e}")
    elif process:
        app.logger.info(f"ttyd process {process.pid} on port {port} already terminated.")
        cleaned = True

    # --- Notes file deletion REMOVED ---

    if cleaned: app.logger.info(f"Successfully cleaned up processes for port {port}")
    else: app.logger.warning(f"Could not find active processes to clean up for port {port}")
    return cleaned


def cleanup_processes(signal_num=None, frame=None):
    """Cleans up ALL running ttyd and tmux processes on exit or signal (DOES NOT DELETE NOTES)."""
    trigger = f"signal {signal_num}" if signal_num is not None else "atexit"
    ports_to_clean = set(_running_ttyd_processes.keys()) | set(_running_tmux_sessions.keys())
    app.logger.info(f"Cleanup triggered by {trigger}. Cleaning up terminal processes for ports: {list(ports_to_clean)}")
    for port in ports_to_clean: cleanup_single_terminal(port) # Calls the modified version
    if signal_num is not None and not os.environ.get('WERKZEUG_RUN_MAIN'):
        exit_code = 128 + signal_num
        app.logger.info(f"Exiting script with code {exit_code} due to signal {signal_num}.")
        sys.stdout.flush(); sys.stderr.flush(); os._exit(exit_code)

atexit.register(cleanup_processes)
try:
    signal.signal(signal.SIGINT, cleanup_processes); signal.signal(signal.SIGTERM, cleanup_processes)
    app.logger.info("Registered signal handlers for SIGINT and SIGTERM.")
except (ValueError, AttributeError, OSError) as e:
    app.logger.warning(f"Could not set signal handlers: {e}. Cleanup might not run on Ctrl+C/kill.")


# --- Playbook section removed (parsing/loading handled client-side) ---

# --- Notes API Endpoints ---

def sanitize_terminal_id(terminal_id):
    """Strictly validates terminal ID format ('term-main' or 'term-<digits>')."""
    if terminal_id == "term-main":
        return terminal_id
    # Allow only digits after 'term-'
    if re.fullmatch(r"term-\d+", terminal_id):
        return terminal_id
    app.logger.warning(f"Invalid terminal_id format received: {terminal_id}")
    return None # Invalid format

@app.route('/api/notes/global', methods=['GET'])
def get_global_notes():
    filepath = os.path.join(NOTES_DIR, "global_notes.txt")
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            return jsonify({"success": True, "notes": content})
        else:
            return jsonify({"success": True, "notes": ""}) # Return empty if not found
    except Exception as e:
        app.logger.error(f"Error reading global notes: {e}", exc_info=True)
        return jsonify({"success": False, "error": "Failed to read global notes"}), 500

@app.route('/api/notes/global', methods=['POST'])
def save_global_notes():
    filepath = os.path.join(NOTES_DIR, "global_notes.txt")
    data = request.get_json()
    if data is None or 'notes' not in data:
        return jsonify({"success": False, "error": "Invalid request body"}), 400
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(data['notes'])
        return jsonify({"success": True, "message": "Global notes saved"})
    except Exception as e:
        app.logger.error(f"Error saving global notes: {e}", exc_info=True)
        return jsonify({"success": False, "error": "Failed to save global notes"}), 500

@app.route('/api/notes/tab/<terminal_id>', methods=['GET'])
def get_tab_notes(terminal_id):
    safe_terminal_id = sanitize_terminal_id(terminal_id)
    if not safe_terminal_id:
        return jsonify({"success": False, "error": "Invalid terminal ID format"}), 400

    filename = f"tab_notes_{safe_terminal_id}.txt"
    filepath = os.path.join(NOTES_DIR, filename)
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            return jsonify({"success": True, "notes": content})
        else:
             # If file doesn't exist, return empty notes successfully
            return jsonify({"success": True, "notes": ""})
    except Exception as e:
        app.logger.error(f"Error reading notes for {safe_terminal_id}: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Failed to read notes for {safe_terminal_id}"}), 500

@app.route('/api/notes/tab/<terminal_id>', methods=['POST'])
def save_tab_notes(terminal_id):
    safe_terminal_id = sanitize_terminal_id(terminal_id)
    if not safe_terminal_id:
        return jsonify({"success": False, "error": "Invalid terminal ID format"}), 400

    data = request.get_json()
    if data is None or 'notes' not in data:
        return jsonify({"success": False, "error": "Invalid request body"}), 400

    filename = f"tab_notes_{safe_terminal_id}.txt"
    filepath = os.path.join(NOTES_DIR, filename)
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(data['notes'])
        return jsonify({"success": True, "message": f"Notes saved for {safe_terminal_id}"})
    except Exception as e:
        app.logger.error(f"Error saving notes for {safe_terminal_id}: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Failed to save notes for {safe_terminal_id}"}), 500

# --- END Notes API Endpoints ---


# --- Terminal Management Endpoints ---
@app.route('/api/terminals/new', methods=['POST'])
def new_terminal():
    """API endpoint to start a new ttyd/tmux terminal instance."""
    global _next_ttyd_port
    found_port = find_available_port(_next_ttyd_port, _max_ttyd_port)
    if found_port is None:
        return jsonify({'success': False, 'error': 'No available ports found.'}), 503

    current_start_port = _next_ttyd_port
    _next_ttyd_port = found_port + 1
    if _next_ttyd_port > _max_ttyd_port: _next_ttyd_port = 7682 # Wrap around

    process = start_ttyd_process(found_port)
    if process:
        try:
            process.wait(timeout=0.5)
            app.logger.error(f"ttyd process on port {found_port} exited immediately.")
            if found_port in _running_ttyd_processes: del _running_ttyd_processes[found_port]
            if found_port in _running_tmux_sessions: del _running_tmux_sessions[found_port]
            _next_ttyd_port = current_start_port
            return jsonify({'success': False, 'error': 'Terminal process failed to start properly.'}), 500
        except subprocess.TimeoutExpired:
            app.logger.info(f"New terminal OK: PID {process.pid} on port {found_port}.")
            return jsonify({'success': True, 'port': found_port, 'url': f'http://localhost:{found_port}'}), 200
    else:
        _next_ttyd_port = current_start_port
        return jsonify({'success': False, 'error': 'Failed to start terminal process.'}), 500

@app.route('/api/terminals/sendkeys', methods=['POST'])
def send_keys_to_terminal():
    """API endpoint to send command/keys to a specific tmux session."""
    data = request.get_json()
    if not data: return jsonify({'success': False, 'error': 'Invalid JSON body.'}), 400

    port = data.get('port')
    command = data.get('command')

    if port is None or command is None: return jsonify({'success': False, 'error': 'Missing "port" or "command".'}), 400
    try: port = int(port)
    except ValueError: return jsonify({'success': False, 'error': 'Invalid port number.'}), 400

    session_name = _running_tmux_sessions.get(port)
    if not session_name:
        app.logger.error(f"Send keys failed: No active tmux session found for port {port}.")
        if port in _running_ttyd_processes:
             proc = _running_ttyd_processes.pop(port, None)
             if proc and proc.poll() is None: proc.kill()
        return jsonify({'success': False, 'error': f'No active terminal session for port {port}.'}), 404

    app.logger.info(f"Sending keys to tmux '{session_name}' (Port: {port})")
    try:
        cmd_to_send = command if command.endswith('\n') else command + "\n"
        send_keys_cmd = [TMUX_COMMAND, 'send-keys', '-t', session_name, cmd_to_send]
        result = subprocess.run(send_keys_cmd, check=False, capture_output=True, text=True, timeout=5)

        if result.returncode == 0:
            app.logger.info(f"Keys sent successfully to tmux '{session_name}'.")
            return jsonify({'success': True, 'message': 'Command sent successfully.'}), 200
        else:
            stderr_lower = result.stderr.lower()
            if "session not found" in stderr_lower or "no server running" in stderr_lower:
                 app.logger.error(f"Tmux error: Session '{session_name}' not found or server dead.")
                 if port in _running_tmux_sessions: del _running_tmux_sessions[port]
                 if port in _running_ttyd_processes:
                     proc = _running_ttyd_processes.pop(port, None)
                     if proc and proc.poll() is None: proc.kill()
                 return jsonify({'success': False, 'error': f'Tmux session "{session_name}" not found.'}), 404
            else:
                app.logger.error(f"Tmux error sending keys. RC: {result.returncode}, Stderr: {result.stderr.strip()}")
                return jsonify({'success': False, 'error': f'Tmux error: {result.stderr.strip()}'}), 500

    except FileNotFoundError:
        app.logger.error(f"'{TMUX_COMMAND}' not found. Cannot send keys.")
        return jsonify({'success': False, 'error': f"'{TMUX_COMMAND}' command not found."}), 500
    except subprocess.TimeoutExpired:
        app.logger.error(f"Timeout sending keys to tmux '{session_name}'.")
        return jsonify({'success': False, 'error': 'Timeout sending command.'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error sending keys: {e}", exc_info=True)
        return jsonify({'success': False, 'error': 'Unexpected server error sending keys.'}), 500

# Modified DELETE route to NOT remove notes file implicitly
@app.route('/api/terminals/<int:port>', methods=['DELETE'])
def delete_terminal(port):
    """API endpoint to stop and clean up a specific terminal instance's processes."""
    app.logger.info(f"Received request to delete terminal processes for port: {port}")
    if port == _initial_ttyd_port:
        return jsonify({'success': False, 'error': 'Cannot delete the main terminal.'}), 403

    is_tracked = port in _running_ttyd_processes or port in _running_tmux_sessions
    if not is_tracked:
         app.logger.warning(f"Request to delete untracked terminal port: {port}.")
         # Notes file is intentionally NOT deleted here for orphaned case
         return jsonify({'success': True, 'message': f'Terminal on port {port} was not actively tracked.'}), 200

    # If tracked, cleanup_single_terminal handles process removal
    cleaned_up = cleanup_single_terminal(port) # This no longer deletes notes

    if cleaned_up:
        return jsonify({'success': True, 'message': f'Terminal processes on port {port} stopped and cleaned up.'}), 200
    else:
        return jsonify({'success': False, 'error': f'Failed to fully clean up terminal processes on port {port}.'}), 500


# --- Main Route (Unchanged) ---
@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html', _initial_ttyd_port=_initial_ttyd_port)

# --- Initial Terminal Startup (Unchanged) ---
def start_initial_ttyd():
    """Starts the initial ttyd instance on the predefined port."""
    if not os.environ.get('WERKZEUG_RUN_MAIN'):
        app.logger.info(f"Attempting to start initial ttyd on port {_initial_ttyd_port}...")
        process = start_ttyd_process(_initial_ttyd_port, initial_terminal=True)
        if not process:
            app.logger.critical(f"CRITICAL: Failed start initial ttyd on port {_initial_ttyd_port}.")
        else:
             try:
                process.wait(timeout=0.5)
                app.logger.critical(f"CRITICAL: Initial ttyd process PID {process.pid} exited immediately.")
                if _initial_ttyd_port in _running_ttyd_processes: del _running_ttyd_processes[_initial_ttyd_port]
                if _initial_ttyd_port in _running_tmux_sessions: del _running_tmux_sessions[_initial_ttyd_port]
             except subprocess.TimeoutExpired:
                app.logger.info(f"Initial ttyd process {process.pid} running OK.")
    else:
        app.logger.info("Skipping initial ttyd start in Werkzeug reloader process.")


# --- Run Application ---
if __name__ == '__main__':
    start_initial_ttyd()
    app.logger.info("Starting Flask application server...")
    try:
        # WARNING: Running on 0.0.0.0 makes the app accessible from your network.
        # use_reloader=False is strongly recommended. debug=False for production.
        app.run(debug=False, host='127.0.0.1', port=5000, use_reloader=False)
    except Exception as e:
         app.logger.error(f"Flask app run failed: {e}", exc_info=True)
         cleanup_processes() # Attempt cleanup on failure
