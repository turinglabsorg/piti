FROM python:3.12-slim

RUN pip install --no-cache-dir duckduckgo-mcp-server

EXPOSE 5100

CMD ["duckduckgo-mcp-server", "--transport", "sse", "--host", "0.0.0.0", "--port", "5100"]
