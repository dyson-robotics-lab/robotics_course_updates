#!/bin/bash

if [[ $EUID > 0 ]]; then
  echo "This script requires sudo"
  exit 1
fi

rm /opt/brickpiexplorer/public/index.html
rm /opt/brickpiexplorer/app.js

cp /home/pi/robotics_course_updates/index.html /opt/brickpiexplorer/public/.
cp /home/pi/robotics_course_updates/app.js /opt/brickpiexplorer/.


systemctl restart explorer_server.service
