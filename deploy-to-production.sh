#!/bin/bash

git checkout test
git pull origin test
git checkout production
git pull origin production
git merge test
git push origin production
git checkout main
