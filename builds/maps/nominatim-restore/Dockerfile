FROM mediagis/nominatim:5.2

USER root

COPY restore-and-start.sh /usr/local/bin/restore-and-start.sh

RUN chmod +x /usr/local/bin/restore-and-start.sh

ENTRYPOINT ["/usr/local/bin/restore-and-start.sh"]
CMD ["/app/start.sh"]