"""Build a Lemonade /load body from the catalog and Helena's saved model options."""

import json
import re
import sys
from pathlib import Path


def positive(value, maximum):
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= maximum


def load_body(name, kind, context, backend, pinned, path):
    options = json.loads(Path(path).read_text()).get(name, {}) if Path(path).exists() else {}
    if not isinstance(options, dict):
        raise ValueError('Invalid model options')
    selected_backend = options.get('backend') or backend
    if selected_backend not in ('rocm', 'vulkan', '-', ''):
        raise ValueError('Invalid backend')
    spec_type = options.get('specType')
    if spec_type not in (None, 'draft-mtp', 'draft-dflash'):
        raise ValueError('Invalid speculative decoding type')
    draft_model = options.get('draftModel')
    if draft_model is not None:
        if not isinstance(draft_model, str) or not re.fullmatch(r'/var/lib/helena-ai/models/[A-Za-z0-9_./-]+\.gguf', draft_model) or '..' in draft_model.split('/'):
            raise ValueError('Invalid draft model path')
    if (spec_type == 'draft-dflash') != (draft_model is not None):
        raise ValueError('draft-dflash requires a draft model')
    draft_tokens = options.get('draftTokens')
    if draft_tokens is not None and (not spec_type or not positive(draft_tokens, 64)):
        raise ValueError('Invalid draft token count')
    parallel = options.get('parallel')
    if parallel is not None and not positive(parallel, 32):
        raise ValueError('Invalid parallel slot count')
    per_slot = options.get('contextPerSlot')
    if per_slot is not None and (parallel is None or not positive(per_slot, 1_048_576)):
        raise ValueError('Invalid context per slot')
    if per_slot is not None and per_slot * parallel > 1_048_576:
        raise ValueError('Total context exceeds 1048576')

    body = {'model_name': name, 'ctx_size': per_slot * parallel if per_slot else int(context or 65536),
            'save_options': True}
    if pinned:
        body['pinned'] = True
    if selected_backend not in ('', '-'):
        body['llamacpp_backend'] = selected_backend
    if kind == 'gguf':
        args = "--load-mode none --chat-template-kwargs '{\"enable_thinking\":false,\"preserve_thinking\":true}'"
        if spec_type:
            args += f' --spec-type {spec_type}'
        if draft_tokens is not None:
            args += f' --spec-draft-n-max {draft_tokens}'
        if draft_model is not None:
            args += f' --spec-draft-model {draft_model}'
        if parallel is not None:
            args += f' -np {parallel}'
        if per_slot is not None:
            args += f' --kv-unified-per-slot {per_slot}'
        body['llamacpp_args'] = args
    elif spec_type or draft_tokens or parallel or per_slot:
        raise ValueError('llama.cpp options require a GGUF model')
    return body


if __name__ == '__main__':
    try:
        print(json.dumps(load_body(*sys.argv[1:]), separators=(',', ':')))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        sys.exit(f'model-options: {error}')
