#!/bin/bash
cd ~/code/auto-eliza-m
npm run server &
echo "Starting frontend server..."
sleep 5
npm start 