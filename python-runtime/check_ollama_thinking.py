import subprocess
import requests
import json

OLLAMA_URL = "http://localhost:11434"

# Thinking values commonly supported by Ollama models
THINKING_LEVELS = [
    True,
    False,
    "low",
    "medium",
    "high",
]

def get_models():
    result = subprocess.run(
        ["ollama", "list"],
        capture_output=True,
        text=True
    )

    models = []

    for line in result.stdout.splitlines()[1:]:
        if line.strip():
            name = line.split()[0]
            models.append(name)

    return models


def test_thinking(model, level):
    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": "Say hello."
                    }
                ],
                "stream": False,
                "think": level
            },
            timeout=120
        )

        if response.status_code != 200:
            return False, response.text

        data = response.json()

        # Ollama may return thinking separately
        has_thinking = bool(
            data.get("message", {}).get("thinking")
        )

        return True, has_thinking

    except Exception as e:
        return False, str(e)


def main():
    models = get_models()

    print("\n========================================")
    print("      OLLAMA THINKING CAPABILITY")
    print("========================================\n")

    if not models:
        print("No models found.")
        return

    for model in models:

        print(f"\nMODEL: {model}")
        print("-" * 50)

        supported = []

        for level in THINKING_LEVELS:

            ok, result = test_thinking(model, level)

            if ok:
                if level is True:
                    name = "true/default"
                elif level is False:
                    name = "false"
                else:
                    name = level

                print(f"  {name:<15} -> ACCEPTED", end="")

                if result is True:
                    print(" | thinking output detected")
                else:
                    print(" | no thinking output")

                supported.append(name)

            else:
                print(f"  {str(level):<15} -> NOT SUPPORTED")

        print(f"\n  Supported: {', '.join(supported) if supported else 'None'}")


if __name__ == "__main__":
    main()