import os
from pathlib import Path

# Directories excluded from the project tree.
EXCLUDED_DIRS = {
    "node_modules",
    "venv",
    ".venv",
    "env",
    ".env",
    "__pycache__",
    ".git",
    ".idea",
    ".vscode",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".pytest_cache",
    ".mypy_cache",
    ".tox",
    "site-packages",
    "offload_weights",
    "target",
    ".turbo",
    ".cache",
    "vendor",
    "logs",
}

OUTPUT_FILE = "app-tree.txt"


def should_exclude_dir(name: str) -> bool:
    """Return True for virtual environments and generated/dependency folders."""
    return (
        name in EXCLUDED_DIRS
        or name.endswith("_env")
        or name.endswith("-venv")
        or name.endswith(".egg-info")
    )


def write_tree(root: Path, output_path: Path) -> None:
    """Write a readable directory/file tree, excluding generated folders."""
    with output_path.open("w", encoding="utf-8", newline="\n") as out:
        out.write(f"{root.name or str(root)}/\n")

        def walk(directory: Path, depth: int) -> None:
            try:
                entries = sorted(
                    (
                        entry
                        for entry in directory.iterdir()
                        if entry.name != output_path.name
                        and not (
                            entry.is_dir()
                            and should_exclude_dir(entry.name)
                        )
                    ),
                    key=lambda entry: (not entry.is_dir(), entry.name.lower()),
                )
            except (PermissionError, OSError):
                return

            for entry in entries:
                out.write(f"{'    ' * depth}|-- {entry.name}\n")
                if entry.is_dir():
                    walk(entry, depth + 1)

        walk(root, 1)


if __name__ == "__main__":
    project_root = Path.cwd().resolve()
    output_path = project_root / OUTPUT_FILE
    write_tree(project_root, output_path)
    print(f"Project tree saved to: {output_path}")
