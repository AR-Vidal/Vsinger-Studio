"""
Standalone dataset preprocessor for ACE-Step LoRA training.

Converts labeled audio samples from a dataset JSON into pre-computed
tensor files (.pt) suitable for training. This script loads the VAE and
text encoder independently, so it does NOT require the Gradio app to be
running.

Usage:
    python preprocess_dataset.py --dataset /path/to/dataset.json --output /path/to/tensors [--json]

The --json flag makes the script output a final JSON summary line to stdout.
"""

import argparse
import json
import os
import sys
import torch

def safe_print(*values, stream=None):
    text = " ".join(str(value) for value in values)
    target = stream or sys.stdout
    encoding = getattr(target, "encoding", None) or "utf-8"
    sanitized = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
    print(sanitized, file=target)


def env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}

def main():
    parser = argparse.ArgumentParser(description="Preprocess dataset to tensors for LoRA training")
    parser.add_argument("--dataset", required=True, help="Path to dataset JSON file")
    parser.add_argument("--output", required=True, help="Output directory for tensor files")
    parser.add_argument("--max-duration", type=float, default=240.0, help="Max audio duration in seconds")
    parser.add_argument("--json", action="store_true", help="Output JSON summary")
    args = parser.parse_args()

    if not os.path.exists(args.dataset):
        print(f"Error: Dataset file not found: {args.dataset}", file=sys.stderr)
        sys.exit(1)

    # Add ACE-Step root to path for imports
    ace_step_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    # Walk up to find ACE-Step-1.5 directory
    for candidate in [
        os.path.join(ace_step_root, "ACE-Step-1.5"),
        os.path.join(os.path.dirname(ace_step_root), "ACE-Step-1.5"),
        os.getcwd(),
    ]:
        if os.path.isdir(candidate) and os.path.isdir(os.path.join(candidate, "acestep")):
            ace_step_root = candidate
            break

    if ace_step_root not in sys.path:
        sys.path.insert(0, ace_step_root)

    hf_cache_root = os.path.join(ace_step_root, ".cache", "huggingface")
    os.makedirs(hf_cache_root, exist_ok=True)
    os.makedirs(os.path.join(hf_cache_root, "hub"), exist_ok=True)
    os.makedirs(os.path.join(hf_cache_root, "transformers"), exist_ok=True)
    os.makedirs(os.path.join(hf_cache_root, "modules"), exist_ok=True)
    os.environ.setdefault("HF_HOME", hf_cache_root)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(hf_cache_root, "hub"))
    os.environ.setdefault("TRANSFORMERS_CACHE", os.path.join(hf_cache_root, "transformers"))
    os.environ.setdefault("HF_MODULES_CACHE", os.path.join(hf_cache_root, "modules"))

    try:
        from acestep.training.dataset_builder import DatasetBuilder
    except ImportError as e:
        print(f"Error: Could not import ACE-Step modules: {e}", file=sys.stderr)
        print("Make sure this script is run from the ACE-Step-1.5 directory or with the correct Python environment.", file=sys.stderr)
        sys.exit(1)

    # Load dataset JSON via the current ACE-Step DatasetBuilder API
    safe_print(f"Loading dataset: {args.dataset}")
    builder = DatasetBuilder()
    samples, load_status = builder.load_dataset(args.dataset)
    safe_print(load_status)

    if not samples:
        message = load_status or f"Failed to load dataset: {args.dataset}"
        safe_print(f"Error: {message}", stream=sys.stderr)
        if args.json:
            safe_print(json.dumps({"status": "error", "message": message, "samples": 0}))
        sys.exit(1)

    labeled_count = sum(1 for s in builder.samples if s.labeled)
    total_count = len(builder.samples)
    safe_print(f"Dataset loaded: {total_count} samples, {labeled_count} labeled")

    if labeled_count == 0:
        msg = "No labeled samples found. Please label samples before preprocessing."
        safe_print(f"Warning: {msg}", stream=sys.stderr)
        if args.json:
            safe_print(json.dumps({"status": "error", "message": msg, "labeled": 0, "total": total_count}))
        sys.exit(1)

    # Load models for preprocessing
    safe_print("Loading models for preprocessing (this may take a moment)...")
    handler = None
    try:
        from acestep.handler import AceStepHandler

        if os.environ.get("ACESTEP_CONFIG_PATH", "").strip():
            config_path = os.environ["ACESTEP_CONFIG_PATH"].strip()
        else:
            config_path = "acestep-v15-turbo"

        requested_device = os.environ.get("ACESTEP_DEVICE", "auto").strip() or "auto"

        # Favor CPU offload on CUDA by default for 12GB-class GPUs unless the user explicitly disables it.
        offload_to_cpu = env_bool("ACESTEP_OFFLOAD_TO_CPU", default=torch.cuda.is_available())
        offload_dit_to_cpu = env_bool("ACESTEP_OFFLOAD_DIT_TO_CPU", default=torch.cuda.is_available())
        use_flash_attention = env_bool("ACESTEP_USE_FLASH_ATTENTION", default=False)
        compile_model = env_bool("ACESTEP_COMPILE_MODEL", default=False)

        handler = AceStepHandler()
        init_status, ok = handler.initialize_service(
            project_root=ace_step_root,
            config_path=config_path,
            device=requested_device,
            use_flash_attention=use_flash_attention,
            compile_model=compile_model,
            offload_to_cpu=offload_to_cpu,
            offload_dit_to_cpu=offload_dit_to_cpu,
        )

        if not ok:
            raise RuntimeError(init_status)

        safe_print(init_status)
    except Exception as e:
        safe_print(f"Warning: Could not initialize preprocessing models: {e}", stream=sys.stderr)
        safe_print("Preprocessing requires model access. Please use the Gradio UI for preprocessing.", stream=sys.stderr)
        if args.json:
            safe_print(json.dumps({
                "status": "error",
                "message": f"Model loading failed: {str(e)}. Use Gradio UI preprocess instead.",
                "labeled": labeled_count,
                "total": total_count,
            }))
        sys.exit(1)

    # Run preprocessing
    os.makedirs(args.output, exist_ok=True)
    safe_print(f"Preprocessing to: {args.output}")

    def progress_cb(msg):
        safe_print(f"  {msg}")

    output_paths, status = builder.preprocess_to_tensors(
        dit_handler=handler,
        output_dir=args.output,
        max_duration=args.max_duration,
        progress_callback=progress_cb,
    )

    safe_print(f"Done: {status}")
    safe_print(f"Output files: {len(output_paths)}")

    failed = " failed)" in status or " failed" in status
    if len(output_paths) == 0 or failed:
        message = status
        if args.json:
            safe_print(json.dumps({
                "status": "error",
                "message": message,
                "output_files": len(output_paths),
                "output_dir": args.output,
                "labeled": labeled_count,
                "total": total_count,
            }))
        sys.exit(1)

    if args.json:
        safe_print(json.dumps({
            "status": "complete",
            "message": status,
            "output_files": len(output_paths),
            "output_dir": args.output,
            "labeled": labeled_count,
            "total": total_count,
        }))

    # Torch/CUDA teardown can crash on Windows even after successful preprocessing.
    # Since this script always runs as a dedicated subprocess, a hard exit is safe here.
    if sys.platform == "win32":
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)


if __name__ == "__main__":
    main()
