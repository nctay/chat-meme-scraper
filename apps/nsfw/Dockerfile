FROM python:3.12-slim-bookworm

WORKDIR /app
RUN pip install --no-cache-dir huggingface_hub==2.0.0 numpy==2.5.3 onnxruntime==1.30.0 Pillow==12.3.0
RUN python -c "from huggingface_hub import hf_hub_download; [hf_hub_download('SmilingWolf/wd-vit-tagger-v3', name, revision='1a42a2f7fa13f005a8a040d0a68e16523865f562', local_dir='/app/model') for name in ('model.onnx', 'selected_tags.csv')]"
COPY apps/nsfw/server.py /app/server.py
RUN python -c "import io, server; from PIL import Image; image=io.BytesIO(); Image.new('RGB', (32, 16)).save(image, format='JPEG'); scores=server.classify(image.getvalue()); assert set(scores)=={'nude', 'nipples'} and all(0 <= score <= 1 for score in scores.values())"

EXPOSE 3333
CMD ["python", "server.py"]
