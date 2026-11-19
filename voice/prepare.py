"""Download once; runtime loads ./kokoro offline, without external API calls."""
from pathlib import Path
from huggingface_hub import snapshot_download

base = Path(__file__).resolve().parent
snapshot_download(
    repo_id="hexgrad/Kokoro-82M",
    local_dir=base / "kokoro",
    allow_patterns=["config.json", "kokoro-v1_0.pth", "voices/pm_alex.pt", "voices/pm_santa.pt", "LICENSE*", "README.md"],
)
print("Kokoro-82M (Apache 2.0) downloaded to voice/kokoro. Keep this folder for offline use.")
