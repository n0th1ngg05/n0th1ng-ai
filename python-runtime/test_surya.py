from surya.foundation import FoundationPredictor
import inspect

print("Public methods:")
for name, member in inspect.getmembers(FoundationPredictor):
    if callable(member) and not name.startswith("_"):
        print(name)

print("\nSource file:")
print(inspect.getfile(FoundationPredictor))