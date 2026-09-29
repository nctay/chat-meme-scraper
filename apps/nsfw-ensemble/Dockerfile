FROM python:3.11-slim-bookworm

WORKDIR /app
RUN pip install --no-cache-dir torch==2.8.0+cpu --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir transformers==4.56.2 pillow==11.3.0 onnxruntime==1.23.2
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('OwenElliott/image-safety-classifier-s', revision='015042b0eab17f1b17f2986527386346fb0d94be', allow_patterns=['onnx/image-safety-classifier-s.onnx'], local_dir='/app/owen'); snapshot_download('prithivMLmods/siglip2-mini-explicit-content', revision='fb2e0dace7e1d6e98dd57671e99e888dc4893540', allow_patterns=['config.json', 'model.safetensors', 'preprocessor_config.json'], local_dir='/app/siglip')"
COPY apps/nsfw-ensemble/server.py /app/server.py
RUN python -c "import io, server; from PIL import Image; image=io.BytesIO(); Image.new('RGB', (32, 16)).save(image, format='JPEG'); scores=server.classify(image.getvalue()); assert all(0 <= value <= 1 for value in scores.values())"

ENV HF_HUB_OFFLINE=1
EXPOSE 3333
CMD ["python", "server.py"]
