from chatterbox.tts import ChatterboxTTS
import soundfile as sf
import time

print("Loading model...")

t0 = time.time()

model = ChatterboxTTS.from_pretrained(device="cuda")

print(f"Loaded in {time.time()-t0:.2f}s")

print("Generating...")

t1 = time.time()

wav = model.generate(
    "The web address nothingstudios.site points to a service page (https://nothingstudios.site) that describes n0th1ng Studios – Event Visual Production & Video Editing in Kolkata. According to the page’s description, it is an event‑production and visual‑editing company that offers end‑to‑end services such as corporate functions, music‑festival production, VFX, LED‑wall graphics, and high‑quality video editing. The site promotes hiring them for events in Kolkata and claims they render your imagination into unforgettable experiences. So, nothingstudios.site is not the old recording studio from the early 1900s that hosted Deaf Trent Reznor’s label; it’s a modern digital‑media/visual‑production business operating out of Kolkata (India)."
)

print(f"Generated in {time.time()-t1:.2f}s")

audio = wav.squeeze(0).cpu().numpy()

sf.write(
    "test.wav",
    audio,
    model.sr,
)

print("Done.")