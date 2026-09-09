import sys, glob, re

if len(sys.argv) < 2:
    sys.exit(1)

pack_dir = sys.argv[1]
mods = []

for file in glob.glob(f"{pack_dir}/mods/*.toml"):
    with open(file, "r", encoding="utf-8") as f:
        content = f.read()
        name_match = re.search(r"^name\s*=\s*\"([^\"]+)\"", content, re.MULTILINE)
        filename_match = re.search(r"^\s*filename\s*=\s*\"([^\"]+)\"", content, re.MULTILINE)
        side_match = re.search(r"^\s*side\s*=\s*\"([^\"]+)\"", content, re.MULTILINE)

        if name_match:
            name = name_match.group(1)
            filename = filename_match.group(1) if filename_match else None
            side = side_match.group(1) if side_match else "both"

            label = f"{name} ({filename})" if filename else name
            if side != "both":
                label += f" [{side}]"
            mods.append(label)

mods.sort(key=lambda x: x.lower())
for line in mods:
    print(line)
