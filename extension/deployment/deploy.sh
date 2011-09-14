#!/bin/bash

# move outside extension directory
cd ../..

# add extension-deployed directory
echo 'Copying extension directory...'
if [ -d 'extension-deployed' ]
then
    echo 'Removing old extension-deployed directory...'
    rm -rf extension-deployed
fi
cp -r extension extension-deployed

# set development equal to false in the content and background script
echo 'Setting development variable to false...'
perl -pi -e 's/^\s*var\s+development\s*=\s*true\s*;.*$/var development = false;/m' extension-deployed/content-script.js extension-deployed/background-script.js

# set up for minification
cd extension-deployed
cp deployment/minify-list.txt temp

# minify files
echo 'Minifying files...'
perl -pi -e 's/^(.*)\.(js|css)$/java -jar \/Users\/Karthik\/Desktop\/Website\/yuicompressor-2.4.2.jar -o \1.\2 \1.\2/m' temp
chmod +x temp
./temp

# delete .swp/.swo files from vim
find . -type f -name *.swp -delete
find . -type f -name *.swo -delete

# clean up
rm temp
rm -rf deployment
echo 'Done!'

