#!/bin/bash
# Cleanup stale PITI agent containers
# Run via cron: */5 * * * * /path/to/cleanup-containers.sh

echo "Cleaning up stale piti-agent containers..."
docker ps -a --filter "name=piti-agent-" --filter "status=exited" -q | xargs -r docker rm
echo "Done."
