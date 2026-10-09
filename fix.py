with open("frontend/src/app/page.tsx", "r") as f:
    lines = f.readlines()

while not lines[-1].strip() or lines[-1].strip() in ["</div>", "  );", "}", ");"]:
    lines.pop()

lines.append("    </div>\n  );\n}\n")

with open("frontend/src/app/page.tsx", "w") as f:
    f.writelines(lines)
