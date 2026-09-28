import io
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from PIL import Image, UnidentifiedImageError
from transformers import AutoImageProcessor, AutoModelForImageClassification


torch.set_num_threads(2)
processor = AutoImageProcessor.from_pretrained('/app/model', use_fast=False)
model = AutoModelForImageClassification.from_pretrained('/app/model').eval()
nsfw_index = {label.lower(): index for index, label in model.config.id2label.items()}['nsfw']


def classify(data):
    with Image.open(io.BytesIO(data)) as opened:
        if opened.width * opened.height > 40_000_000:
            raise ValueError('image dimensions exceed limit')
        image = opened.convert('RGB')
    with torch.inference_mode():
        inputs = processor(images=image, return_tensors='pt')
        return model(**inputs).logits.softmax(dim=-1)[0, nsfw_index].item()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == '/health' else 404)
        self.end_headers()

    def do_POST(self):
        if self.path != '/classify':
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 32 * 1024 * 1024:
                raise ValueError('invalid image size')
            result = {'nsfw': classify(self.rfile.read(size))}
        except (ValueError, UnidentifiedImageError) as error:
            self.send_error(400, str(error))
            return
        except Exception:
            logging.exception('classification failed')
            self.send_error(500)
            return
        body = json.dumps(result).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 3333), Handler).serve_forever()
