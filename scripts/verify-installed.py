"""Run inside dbus-run-session -- xvfb-run -a after installing the .deb."""
import json
import os
import pathlib
import signal
import subprocess
import tempfile
import time
import urllib.request


def wait_for(check, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError("Timed out waiting for installed Opale")


with tempfile.TemporaryDirectory(prefix="opale-installed-") as temp:
    home = pathlib.Path(temp) / "home"
    home.mkdir()
    env = dict(os.environ, OPALE_HOME=str(home), GDK_BACKEND="x11",
               LIBGL_ALWAYS_SOFTWARE="1", WEBKIT_DISABLE_COMPOSITING_MODE="1")
    with open(pathlib.Path(temp) / "native.log", "w") as log:
        child = subprocess.Popen(["/usr/bin/opale"], env=env, stdout=log, stderr=log)
        try:
            instance = home / "instance.json"
            wait_for(instance.exists)
            info = json.loads(instance.read_text())
            root = f"http://127.0.0.1:{info['port']}"
            assert json.load(urllib.request.urlopen(root + "/api/ping"))["app"] == "opale"
            install = json.loads((home / "install.json").read_text())
            # Another application must launch the native installed shell, not an .exe.
            assert "/usr/lib/opale/Opale" in json.dumps(install), install
            window = wait_for(lambda: subprocess.run(
                ["xdotool", "search", "--onlyvisible", "--name", "Opale"],
                capture_output=True, text=True).stdout.strip().splitlines())[-1]
            second = subprocess.run(["/usr/bin/opale"], env=env, timeout=10)
            assert second.returncode == 0
            assert json.loads(instance.read_text())["pid"] == info["pid"]
            subprocess.run(["xdotool", "key", "--window", window, "ctrl+q"], check=True)
            assert child.wait(timeout=15) == 0
            wait_for(lambda: not instance.exists())
            try:
                os.kill(info["pid"], 0)
            except ProcessLookupError:
                pass
            else:
                raise AssertionError("Server survived closing the installed window")
            assert (home / "window.ini").exists()
            print("PASS installed .deb: native window, server, Linux launch metadata, single instance, Ctrl+Q, server cleanup, saved window state")
        finally:
            if child.poll() is None:
                child.send_signal(signal.SIGTERM)
                child.wait(timeout=10)

    # A crashed native shell must not leave its authenticated local server behind.
    with open(pathlib.Path(temp) / "crash.log", "w") as log:
        crashed = subprocess.Popen(["/usr/bin/opale"], env=env, stdout=log, stderr=log)
        try:
            instance = home / "instance.json"
            wait_for(instance.exists)
            crashed.kill()
            crashed.wait(timeout=10)
            wait_for(lambda: not instance.exists(), seconds=10)
            print("PASS installed server exits after native shell is killed")
        finally:
            if crashed.poll() is None:
                crashed.terminate()
                crashed.wait(timeout=10)

    picker = subprocess.Popen(["/usr/lib/opale/opale-pickfolder"], env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        picker_window = wait_for(lambda: subprocess.run(
            ["xdotool", "search", "--onlyvisible", "--name", "Choisissez le dossier"],
            capture_output=True, text=True).stdout.strip().splitlines())[-1]
        subprocess.run(["xdotool", "windowfocus", "--sync", picker_window], check=True)
        time.sleep(0.5)
        subprocess.run(["xdotool", "key", "Escape"], check=True)
        output, _ = picker.communicate(timeout=10)
        assert picker.returncode == 1 and not output.strip()
        print("PASS installed GTK folder picker: visible dialog and cancellation")
    finally:
        if picker.poll() is None:
            picker.terminate()
            picker.wait(timeout=10)
