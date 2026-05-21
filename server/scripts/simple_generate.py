#!/usr/bin/env python3
"""Simple music generation script that works like the Gradio interface.

This is a wrapper script that calls ACE-Step without modifying the original repo.
Supports all ACE-Step generation parameters.
"""
import argparse
import json
import os
import sys
import time
import torch

# Get ACE-Step path from environment or use default
ACESTEP_PATH = os.environ.get('ACESTEP_PATH', '/home/ambsd/Desktop/aceui/ACE-Step-1.5')

# Add ACE-Step to path
sys.path.insert(0, ACESTEP_PATH)

from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music, create_sample

# Global handlers (initialized once)
_handler = None
_llm_handler = None

def get_handlers(need_lm: bool = False, lm_backend: str = "pt", lm_model_path: str | None = None):
    global _handler, _llm_handler
    if _handler is None:
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
        _handler = AceStepHandler()
        _handler.initialize_service(
            project_root=ACESTEP_PATH,
            config_path="acestep-v15-turbo",
            device=device,
            offload_to_cpu=True,  # For 12GB GPU
        )
    if _llm_handler is None:
        _llm_handler = LLMHandler()

    if need_lm and not _llm_handler.llm_initialized:
        available_lm_models = _llm_handler.get_available_5hz_lm_models()
        selected_lm_model = lm_model_path or (available_lm_models[0] if available_lm_models else None)
        if not selected_lm_model:
            raise RuntimeError("No LM models available for automatic lyric generation")

        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

        _llm_handler.initialize(
            checkpoint_dir=os.path.join(ACESTEP_PATH, "checkpoints"),
            lm_model_path=selected_lm_model,
            backend=lm_backend,
            device=device,
            offload_to_cpu=True,
            dtype=None,
        )

    return _handler, _llm_handler

def generate(
    # Basic parameters
    prompt: str,
    lyrics: str = "",
    instrumental: bool = False,
    duration: int = 60,
    bpm: int = 0,
    key_scale: str = "",
    time_signature: str = "",
    vocal_language: str = "auto",

    # Generation parameters
    infer_steps: int = 8,
    guidance_scale: float = 10.0,
    batch_size: int = 1,
    seed: int = -1,
    audio_format: str = "mp3",
    shift: float = 3.0,

    # Task type parameters
    task_type: str = "text2music",
    reference_audio: str = None,
    src_audio: str = None,
    audio_codes: str = "",
    repainting_start: float = 0,
    repainting_end: float = -1,
    audio_cover_strength: float = 1.0,
    instruction: str = "",

    # LM/CoT parameters
    thinking: bool = False,
    lm_temperature: float = 0.85,
    lm_cfg_scale: float = 2.0,
    lm_top_k: int = 0,
    lm_top_p: float = 0.9,
    lm_negative_prompt: str = "",
    sample_query: str = "",
    lm_backend: str = "pt",
    lm_model_path: str | None = None,
    use_cot_metas: bool = True,
    use_cot_caption: bool = True,
    use_cot_language: bool = True,

    # Advanced parameters
    use_adg: bool = False,
    cfg_interval_start: float = 0.0,
    cfg_interval_end: float = 1.0,

    # Output
    output_dir: str = None,
):
    """Generate music and return audio file paths."""
    handler, llm_handler = get_handlers(
        need_lm=bool(sample_query and not instrumental),
        lm_backend=lm_backend,
        lm_model_path=lm_model_path,
    )

    if output_dir is None:
        output_dir = os.path.join(ACESTEP_PATH, "output")
    os.makedirs(output_dir, exist_ok=True)

    resolved_prompt = prompt
    resolved_lyrics = lyrics
    resolved_instrumental = instrumental
    resolved_duration = duration
    resolved_bpm = bpm
    resolved_key_scale = key_scale
    resolved_time_signature = time_signature
    resolved_vocal_language = vocal_language

    if sample_query and not instrumental:
        sample_result = create_sample(
            llm_handler=llm_handler,
            query=sample_query,
            instrumental=False,
            vocal_language=vocal_language if vocal_language and vocal_language not in {"auto", "unknown"} else None,
            temperature=lm_temperature,
            top_k=lm_top_k if lm_top_k > 0 else None,
            top_p=lm_top_p if lm_top_p and lm_top_p < 1.0 else None,
        )
        if not sample_result.success:
            raise RuntimeError(sample_result.error or sample_result.status_message or "create_sample failed")

        resolved_prompt = sample_result.caption or resolved_prompt
        resolved_lyrics = sample_result.lyrics or resolved_lyrics
        resolved_instrumental = bool(getattr(sample_result, "instrumental", False))
        if resolved_duration <= 0 and sample_result.duration:
            resolved_duration = int(sample_result.duration)
        if resolved_bpm <= 0 and sample_result.bpm:
            resolved_bpm = int(sample_result.bpm)
        if not resolved_key_scale and sample_result.keyscale:
            resolved_key_scale = sample_result.keyscale
        if not resolved_time_signature and sample_result.timesignature:
            resolved_time_signature = sample_result.timesignature
        if resolved_vocal_language in {"", "auto", "unknown"} and sample_result.language:
            resolved_vocal_language = sample_result.language

    # Build generation params
    params = GenerationParams(
        # Basic
        task_type=task_type,
        caption=resolved_prompt,
        lyrics=resolved_lyrics if resolved_lyrics and not resolved_instrumental else "",
        instrumental=resolved_instrumental,
        duration=float(resolved_duration) if resolved_duration > 0 else -1.0,
        bpm=resolved_bpm if resolved_bpm > 0 else None,
        keyscale=resolved_key_scale if resolved_key_scale else "",
        timesignature=resolved_time_signature if resolved_time_signature else "",
        vocal_language=resolved_vocal_language if resolved_vocal_language else "auto",

        # Generation
        inference_steps=infer_steps,
        guidance_scale=guidance_scale,
        seed=seed if seed >= 0 else -1,
        shift=shift,

        # Task-specific
        reference_audio=reference_audio if reference_audio else None,
        src_audio=src_audio if src_audio else None,
        audio_codes=audio_codes if audio_codes else "",
        repainting_start=repainting_start,
        repainting_end=repainting_end,
        audio_cover_strength=audio_cover_strength,
        instruction=instruction if instruction else "Fill the audio semantic mask based on the given conditions:",

        # LM/CoT
        thinking=thinking,
        lm_temperature=lm_temperature,
        lm_cfg_scale=lm_cfg_scale,
        lm_top_k=lm_top_k,
        lm_top_p=lm_top_p,
        lm_negative_prompt=lm_negative_prompt if lm_negative_prompt else "NO USER INPUT",
        use_cot_metas=use_cot_metas,
        use_cot_caption=use_cot_caption,
        use_cot_language=use_cot_language,

        # Advanced
        use_adg=use_adg,
        cfg_interval_start=cfg_interval_start,
        cfg_interval_end=cfg_interval_end,
    )

    # Build generation config
    config = GenerationConfig(
        batch_size=batch_size,
        audio_format=audio_format,
        use_random_seed=(seed < 0),
    )

    start_time = time.time()
    result = generate_music(handler, llm_handler, params, config, save_dir=output_dir)
    elapsed = time.time() - start_time

    # Extract audio paths from result
    audio_paths = []
    if result.audios:
        for audio in result.audios:
            if isinstance(audio, dict) and audio.get("path"):
                audio_paths.append(audio["path"])

    return {
        "success": True,
        "audio_paths": audio_paths,
        "elapsed_seconds": elapsed,
        "output_dir": output_dir,
        "caption": resolved_prompt,
        "lyrics": "[Instrumental]" if resolved_instrumental else resolved_lyrics,
        "duration": resolved_duration,
        "bpm": resolved_bpm,
        "key_scale": resolved_key_scale,
        "time_signature": resolved_time_signature,
        "vocal_language": resolved_vocal_language,
    }

def main():
    parser = argparse.ArgumentParser(description="Generate music with ACE-Step")

    # Basic parameters
    parser.add_argument("--prompt", type=str, required=True, help="Music description")
    parser.add_argument("--lyrics", type=str, default="", help="Lyrics (optional)")
    parser.add_argument("--instrumental", action="store_true", help="Generate instrumental music")
    parser.add_argument("--duration", type=int, default=60, help="Duration in seconds (0 for auto)")
    parser.add_argument("--bpm", type=int, default=0, help="BPM (0 for auto)")
    parser.add_argument("--key-scale", type=str, default="", help="Key scale (e.g., 'C Major')")
    parser.add_argument("--time-signature", type=str, default="", help="Time signature (2, 3, 4, or 6)")
    parser.add_argument("--vocal-language", type=str, default="auto", help="Vocal language code")

    # Generation parameters
    parser.add_argument("--infer-steps", type=int, default=8, help="Inference steps")
    parser.add_argument("--guidance-scale", type=float, default=10.0, help="Guidance scale")
    parser.add_argument("--batch-size", type=int, default=1, help="Batch size")
    parser.add_argument("--seed", type=int, default=-1, help="Random seed (-1 for random)")
    parser.add_argument("--audio-format", type=str, default="mp3", choices=["mp3", "flac", "wav"])
    parser.add_argument("--shift", type=float, default=3.0, help="Timestep shift factor")

    # Task type parameters
    parser.add_argument("--task-type", type=str, default="text2music",
                        choices=["text2music", "cover", "repaint", "lego", "extract", "complete"],
                        help="Generation task type")
    parser.add_argument("--reference-audio", type=str, default=None, help="Reference audio path for style transfer")
    parser.add_argument("--src-audio", type=str, default=None, help="Source audio path for audio-to-audio")
    parser.add_argument("--audio-codes", type=str, default="", help="Audio semantic codes")
    parser.add_argument("--repainting-start", type=float, default=0, help="Repainting start time (seconds)")
    parser.add_argument("--repainting-end", type=float, default=-1, help="Repainting end time (seconds)")
    parser.add_argument("--audio-cover-strength", type=float, default=1.0, help="Reference audio strength (0-1)")
    parser.add_argument("--instruction", type=str, default="", help="Task instruction prompt")

    # LM/CoT parameters
    parser.add_argument("--thinking", action="store_true", help="Enable Chain-of-Thought reasoning")
    parser.add_argument("--lm-temperature", type=float, default=0.85, help="LLM temperature")
    parser.add_argument("--lm-cfg-scale", type=float, default=2.0, help="LLM guidance scale")
    parser.add_argument("--lm-top-k", type=int, default=0, help="LLM top-k sampling")
    parser.add_argument("--lm-top-p", type=float, default=0.9, help="LLM top-p sampling")
    parser.add_argument("--lm-negative-prompt", type=str, default="", help="LLM negative prompt")
    parser.add_argument("--sample-query", type=str, default="", help="Auto-generate caption and lyrics from a description")
    parser.add_argument("--sample-query-file", type=str, default="", help="JSON file containing sample_query (avoids CLI encoding issues)")
    parser.add_argument("--lm-backend", type=str, default="pt", choices=["pt", "vllm", "mlx"], help="LM backend")
    parser.add_argument("--lm-model-path", type=str, default=None, help="LM model path or name")
    parser.add_argument("--no-cot-metas", action="store_true", help="Disable CoT for metadata")
    parser.add_argument("--no-cot-caption", action="store_true", help="Disable CoT for caption")
    parser.add_argument("--no-cot-language", action="store_true", help="Disable CoT for language")

    # Advanced parameters
    parser.add_argument("--use-adg", action="store_true", help="Use Adaptive Dual Guidance")
    parser.add_argument("--cfg-interval-start", type=float, default=0.0, help="CFG interval start")
    parser.add_argument("--cfg-interval-end", type=float, default=1.0, help="CFG interval end")

    # Output
    parser.add_argument("--output-dir", type=str, default=None, help="Output directory")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    # Resolve sample_query: prefer file (avoids Windows CLI encoding corruption)
    resolved_sample_query = args.sample_query
    if args.sample_query_file:
        try:
            with open(args.sample_query_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                resolved_sample_query = data.get("sample_query", resolved_sample_query)
        except Exception as e:
            print(f"Warning: failed to read sample-query-file: {e}", file=sys.stderr)

    try:
        result = generate(
            # Basic
            prompt=args.prompt,
            lyrics=args.lyrics,
            instrumental=args.instrumental,
            duration=args.duration,
            bpm=args.bpm,
            key_scale=args.key_scale,
            time_signature=args.time_signature,
            vocal_language=args.vocal_language,

            # Generation
            infer_steps=args.infer_steps,
            guidance_scale=args.guidance_scale,
            batch_size=args.batch_size,
            seed=args.seed,
            audio_format=args.audio_format,
            shift=args.shift,

            # Task type
            task_type=args.task_type,
            reference_audio=args.reference_audio,
            src_audio=args.src_audio,
            audio_codes=args.audio_codes,
            repainting_start=args.repainting_start,
            repainting_end=args.repainting_end,
            audio_cover_strength=args.audio_cover_strength,
            instruction=args.instruction,

            # LM/CoT
            thinking=args.thinking,
            lm_temperature=args.lm_temperature,
            lm_cfg_scale=args.lm_cfg_scale,
            lm_top_k=args.lm_top_k,
            lm_top_p=args.lm_top_p,
            lm_negative_prompt=args.lm_negative_prompt,
            sample_query=resolved_sample_query,
            lm_backend=args.lm_backend,
            lm_model_path=args.lm_model_path,
            use_cot_metas=not args.no_cot_metas,
            use_cot_caption=not args.no_cot_caption,
            use_cot_language=not args.no_cot_language,

            # Advanced
            use_adg=args.use_adg,
            cfg_interval_start=args.cfg_interval_start,
            cfg_interval_end=args.cfg_interval_end,

            # Output
            output_dir=args.output_dir,
        )

        if args.json:
            print(json.dumps(result))
        else:
            print(f"Generated {len(result['audio_paths'])} audio files in {result['elapsed_seconds']:.1f}s:")
            for path in result['audio_paths']:
                print(f"  {path}")
    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
