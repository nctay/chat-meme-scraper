import csv
import io
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image


MODEL_DIR = Path(__file__).with_name('model')
with (MODEL_DIR / 'selected_tags.csv').open(newline='') as file:
    names = [row['name'] for row in csv.DictReader(file)]
tag_indices = {name: names.index(name) for name in ('nude', 'nipples')}
options = ort.SessionOptions()
options.intra_op_num_threads = 1
model = ort.InferenceSession(str(MODEL_DIR / 'model.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
input_name = model.get_inputs()[0].name
output_name = model.get_outputs()[0].name
_, target_size, _, _ = model.get_inputs()[0].shape


def classify(data):
    with Image.open(io.BytesIO(data)) as opened:
        if opened.width * opened.height > 40_000_000:
            raise ValueError('image dimensions exceed limit')
        image = opened.convert('RGBA')
    canvas = Image.new('RGBA', image.size, (255, 255, 255))
    canvas.alpha_composite(image)
    rgb = canvas.convert('RGB')
    side = max(rgb.size)
    square = Image.new('RGB', (side, side), (255, 255, 255))
    square.paste(rgb, ((side - rgb.width) // 2, (side - rgb.height) // 2))
    resized = square.resize((target_size, target_size), Image.Resampling.BICUBIC)
    pixels = np.asarray(resized, dtype=np.float32)[:, :, ::-1][None, ...]
    scores = model.run([output_name], {input_name: pixels})[0][0]
    return {name: float(scores[index]) for name, index in tag_indices.items()}


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
            result = classify(self.rfile.read(size))
        except ValueError as error:
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
