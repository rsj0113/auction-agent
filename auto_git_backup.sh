#!/bin/bash

# Change to the auction_agent directory
cd /Users/seonjin/vscode_project/auction_agent || exit 1

# Add all changes
git add .

# Commit with a timestamp
git commit -m "Auto backup: $(date +'%Y-%m-%d %H:%M:%S')"

# Push to the remote repository
git push
