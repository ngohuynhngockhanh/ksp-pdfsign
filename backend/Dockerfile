FROM python:3.12-slim

# pyHanko[pkcs11] can build deps toi thieu; slim thuong du.
# build-essential/libffi cho pyHanko; openssh-client + sshpass cho SIGNING_MODE=ssh
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev openssh-client sshpass \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
