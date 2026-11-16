import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'dist/update-linux-amd64.json').read_text())
archive = root / 'dist' / manifest['file']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['sha256']
files = ['Opale', 'opale-server', 'opale-pickfolder', 'opale-updater', 'opale-update-install', 'opale.png']
with tempfile.TemporaryDirectory(prefix='opale-update-transaction-') as temp:
    target = pathlib.Path(temp)
    for name in files:
        (target / name).write_bytes(b'previous-test-binary')
    blocker = target / 'opale-server.update-old'
    blocker.mkdir()
    (blocker / 'sentinel').write_text('block rename')
    args = ['bash', str(root / 'native/update-install.sh'), str(archive), '0', '0', str(target), manifest['sha256'], 'archive']
    result = subprocess.run(args, capture_output=True, text=True)
    assert result.returncode != 0, result.stdout
    assert all((target / name).read_bytes() == b'previous-test-binary' for name in files)
    print('PASS failed Linux update restores all previous files')
    shutil.rmtree(blocker)
    result = subprocess.run(args, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert '100 ' in result.stdout
    expected = ['opale', 'opale-server', 'opale-pickfolder', 'opale-updater', 'opale-update-install', 'opale.png']
    for name, source in zip(files, expected):
        assert (target / name).read_bytes() == (root / 'dist' / source).read_bytes(), name
    print('PASS real Linux archive installs all six files byte-for-byte; progress 100%')

    marker=target / 'restart-confirmed'
    restart=target / 'restart-test.sh'
    import shlex
    restart.write_text('#!/bin/sh\nprintf restarted > '+shlex.quote(str(marker))+'\n')
    restart.chmod(0o755)
    subprocess.run([str(root/'dist/opale-updater'),str(root/'dist/opale-update-install'),str(archive),'0','0',str(target),manifest['sha256'],'archive',str(restart)],check=True,timeout=25)
    import time
    for _ in range(30):
        if marker.exists():break
        time.sleep(.1)
    assert marker.read_text()=='restarted'
    print('PASS real GTK update window completes installation and launches restart command')
