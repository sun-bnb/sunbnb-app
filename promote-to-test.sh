#!/bin/bash

git checkout main
git pull origin main
git checkout test
git merge main
git push origin test
git checkout main
