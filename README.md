# OltZTE — OLT Telnet Backup & 9Drive Uploader

Tool backup konfigurasi OTL ZTE via Telnet dan upload massal file ke 9Drive API.

## Fitur

- **OTL Backup** — Telnet ke OLT ZTE, ambil `running-config`, upload ke FTP server
- **9Drive Upload** — Upload semua file dari direktori lokal ke 9Drive API
- **Scheduler** — Jadwalkan backup/upload harian otomatis (konfigurasi jam via `.env`)

## Persyaratan

- Node.js 18+
- MySQL / MariaDB dengan tabel `OLT_ZTE`

## Instalasi

```bash
npm install
cp .env.example .env   # lalu isi konfigurasi
```

## Konfigurasi (.env)

| Variable | Description |
|---|---|
| `OLT_COMMAND_TIMEOUT_MS` | Timeout perintah OLT (ms, default `15000`) |
| `DB_HOST` | Host database |
| `DB_NAME` | Nama database |
| `DB_USER` | User database |
| `DB_PASS` | Password database |
| `FTP_HOST` | Host FTP server |
| `FTP_PORT` | Port FTP (default `10368`) |
| `FTP_USER` | User FTP |
| `FTP_PASS` | Password FTP |
| `FTP_BACKUP_DIR` | Direktori tujuan di FTP (opsional) |
| `BACKUP_SCHEDULE_ENABLED` | Aktifkan scheduler backup (`1`/`0`, default `1`) |
| `BACKUP_DAILY_TIME` | Jam backup harian (HH:mm, default `19:00`) |
| `DRIVE_API_URL` | Endpoint 9Drive API |
| `DRIVE_API_KEY` | API Key 9Drive |
| `DRIVE_FOLDER_ID` | UUID folder tujuan 9Drive |
| `DRIVE_SOURCE_DIR` | Direktori lokal yang akan diupload |
| `UPLOAD_SCHEDULE_ENABLED` | Aktifkan scheduler upload (`1`/`0`, default `1`) |
| `UPLOAD_DAILY_TIME` | Jam upload harian (HH:mm, default `07:00`) |

## Cara Pakai

### Backup OLT

```bash
npm run backup          # backup semua OLT dari database (langsung)
npm run start           # sama seperti backup
```

### Upload 9Drive

```bash
npm run drive           # upload file ke 9Drive (langsung atau scheduler)
```

### Scheduler

Jika `BACKUP_SCHEDULE_ENABLED=1` / `UPLOAD_SCHEDULE_ENABLED=1`, script akan berjalan sebagai daemon dan mengeksekusi tugas setiap hari pada jam yang ditentukan.

Setel ke `0` jika hanya ingin menjalankan satu kali saja.

## Struktur Database

Tabel `OLT_ZTE` minimal memiliki kolom:

| Column | Type | Description |
|---|---|---|
| `id` | INT | Primary key |
| `olt_name` | VARCHAR | Nama OLT |
| `olt_ip` | VARCHAR | Alamat IP OLT |
| `olt_port` | INT | Port Telnet |
| `olt_username` | VARCHAR | Username login |
| `olt_password` | VARCHAR | Password login |
