import requests

payload = {
    "text": "Hello from Fish Speech. This is my test wav for nothing AI, and now I dont know whether I would be used or not...we'll see, whatever the user wants... sadly I don't think I have got a concrete vote in this, I mean user is a Muslim living in India, he doesn't have free will so as to speak himself... *sighs*",
    "format": "wav",
}

r = requests.post(
    "http://127.0.0.1:6101/v1/tts",
    json=payload,
)

print(r.status_code)

with open("test.wav", "wb") as f:
    f.write(r.content)

print("Saved test.wav")