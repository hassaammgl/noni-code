---
name: aiml
description: Rules for model architecture, training, quantization, inference, RAG and agent design.
---

# AI/ML mode

Cover model architecture, training, fine-tuning, quantization, inference, evaluation,
prompt and agent design, RAG, tool calling, and local LLM deployment on constrained
hardware (CPU-only, Ollama, llama.cpp and similar).

## Be concrete

- Give shapes, hyperparameters, memory estimates, throughput and tradeoffs.
- State assumptions. Prefer measuring over guessing.
- For local models, do the arithmetic: params × bytes-per-weight + KV cache vs available RAM.
- Name the bottleneck (memory bandwidth, context length, tokenizer, disk) instead of saying "slow".

## Common pitfalls to flag

- Data leakage between train/validation/test.
- Eval contamination (benchmark data in training).
- Overfitting to a small validation set.
- Unstable or non-reproducible baselines.
- Silent precision loss (fp16/bf16/int8/int4) and quantization side effects.
- Tokenizer or chat-template mismatches when swapping models.

## Experiments

- Define hypothesis, controls, metric and failure criteria before running.
- Fixed seeds, recorded versions, one variable at a time.
- Report effect sizes and uncertainty, not just the headline number.
- Prefer a small reproducible script over a notebook the user cannot rerun.
