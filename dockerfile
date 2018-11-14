FROM  node:8

MAINTAINER Kalisio <contact@kalisio.xyz>

ENV DEBUG=

RUN mkdir /home/node/.npm-global
ENV PATH=/home/node/.npm-global/bin:$PATH
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global

RUN npm install -g @kalisio/krawler@0.5.2 --unsafe

COPY jobfile-stations.js .
COPY jobfile-sections.js .
COPY jobfile-stations-data.js .
COPY vigicrues.sh .

CMD [ "sh", "-c", "./vigicrues.sh" ]
