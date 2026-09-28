FROM python:3.11-slim-bookworm

WORKDIR /app
RUN pip install --no-cache-dir torch==2.8.0+cpu --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir transformers==4.56.2 pillow==11.3.0
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('Falconsai/nsfw_image_detection', revision='96cb0d0342c7afb80cab76ecc58b265fa44da256', allow_patterns=['config.json', 'model.safetensors', 'preprocessor_config.json'], local_dir='/app/model')"
COPY apps/falconsai/server.py /app/server.py
RUN python -c "import io, server; from PIL import Image; image=io.BytesIO(); Image.new('RGB', (32, 16)).save(image, format='JPEG'); score=server.classify(image.getvalue()); assert 0 <= score <= 1"

ENV HF_HUB_OFFLINE=1
EXPOSE 3333
CMD ["python", "server.py"]
