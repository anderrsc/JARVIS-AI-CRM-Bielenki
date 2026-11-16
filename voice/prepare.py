"""Download once; runtime uses from_local, without external API calls."""
from pathlib import Path
from huggingface_hub import snapshot_download

base = Path(__file__).resolve().parent
snapshot_download(
    repo_id="ResembleAI/chatterbox",
    local_dir=base / "model",
    allow_patterns=["ve.pt", "s3gen.pt", "t3_mtl23ls_v2.safetensors", "grapheme_mtl_merged_expanded_v1.json", "Cangjie5_TC.json", "LICENSE*"],
)
print("Local model downloaded. Keep the entire model directory for offline use.")
