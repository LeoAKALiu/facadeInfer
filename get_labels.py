from transformers import AutoConfig
import os
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HF_TOKEN")

try:
    config = AutoConfig.from_pretrained("Xpitfire/segformer-finetuned-segments-cmp-facade", token=token)
    print(config.id2label)
except Exception as e:
    print(f"Error: {e}")
