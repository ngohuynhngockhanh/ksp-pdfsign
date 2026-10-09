import json
import pytest
from app.db import get_session, PieceworkContract
def test_piecework_list_and_details(client):
    # Login as admin
    login_res = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert login_res.status_code == 200
    
    # 1. List contracts
    res = client.get("/api/piecework/contracts")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 3
    
    # Check HĐ 01/2026/HĐGK-DONGSON (< 5M)
    dongson = next(c for c in data["contracts"] if "DONGSON" in c["contract_code"])
    assert dongson["worker_name"] == "Lê Văn Hải"
    assert dongson["total_amount"] == 4500000.0
    assert dongson["deficiency"]["is_sub_5m"] is True
    assert dongson["tax_rate"] == 0.0
    assert dongson["deficiency"]["can_pay"] is True
    
    # Check HĐ 02/2026/HĐGK-SONLA-LL100 (>= 5M)
    sonla = next(c for c in data["contracts"] if "SONLA" in c["contract_code"])
    assert sonla["worker_name"] == "Hoàng Văn Dũng"
    assert sonla["total_amount"] == 6000000.0
    assert sonla["tax_amount"] == 600000.0
    assert sonla["deficiency"]["is_sub_5m"] is False
    assert sonla["deficiency"]["missing_count"] > 0
    
    # 2. Get details
    det_res = client.get(f"/api/piecework/contracts/{dongson['id']}")
    assert det_res.status_code == 200
    det = det_res.json()
    assert len(det["items"]) == 3
    assert len(det["deficiency"]["checklist"]) >= 6


def test_piecework_public_portal_and_signature(client):
    # 1. Fetch public portal HTML
    portal_slug = "sonla-ll100-token-850082"
    res = client.get(f"/khoan/{portal_slug}")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "Hoàng Văn Dũng" in res.text
    assert "sigCanvas" in res.text
    assert "253/2026" in res.text
    
    # 2. Submit touch signature
    dummy_sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    sig_res = client.post(
        f"/api/public/khoan/{portal_slug}/submit-signature",
        json={"signature_data": dummy_sig}
    )
    assert sig_res.status_code == 200
    assert sig_res.json()["ok"] is True
    
    # Verify in DB
    for db in get_session():
        c = db.query(PieceworkContract).filter(PieceworkContract.portal_token == portal_slug).first()
        assert c.is_signed_by_worker is True
        assert c.worker_signature_data == dummy_sig
        assert c.is_signed_by_inut is True
        assert c.contract_pdf_doc_id != ""
        break

def test_piecework_pdf_generation(client):
    portal_slug = "dongson-kiosk-token-849200"
    
    # 1. Default signed PDF
    pdf_res = client.get(f"/api/public/khoan/{portal_slug}/pdf")
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content.startswith(b"%PDF")
    
    # 2. Explicit signed=1
    signed_res = client.get(f"/api/public/khoan/{portal_slug}/pdf?signed=1")
    assert signed_res.status_code == 200
    assert "DA_KY" in signed_res.headers.get("content-disposition", "")
    
    # 3. Explicit draft/unsigned signed=0
    draft_res = client.get(f"/api/public/khoan/{portal_slug}/pdf?signed=0")
    assert draft_res.status_code == 200
    assert "CHUA_KY" in draft_res.headers.get("content-disposition", "")
    assert draft_res.content.startswith(b"%PDF")
def test_piecework_sign_inut_with_custom_date_and_verify(client):
    # Login as admin
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})

    # Create or use a contract
    list_res = client.get("/api/piecework/contracts")
    assert list_res.status_code == 200
    contracts = list_res.json()["contracts"]
    c = contracts[0]
    cid = c["id"]

    # 1. Sign with custom back-dated timestamp
    custom_date_str = "2026-02-15T09:30:00"
    sign_res = client.post(
        f"/api/piecework/contracts/{cid}/sign-inut",
        json={"sign_date": custom_date_str},
    )
    assert sign_res.status_code == 200
    data = sign_res.json()
    assert data["ok"] is True
    assert data["doc_id"] != ""
    assert "2026-02-15" in data["signed_at"]

    # 2. Verify digital signature
    verify_res = client.get(f"/api/piecework/contracts/{cid}/verify-signature")
    assert verify_res.status_code == 200
    vdata = verify_res.json()
    assert vdata["ok"] is True
    assert vdata["has_signature"] is True
    assert vdata["intact"] is True
    assert vdata["valid"] is True
    assert "INUT" in (vdata["signer_name"] or "")
    assert vdata["sign_date_m"] is not None
    assert "2026" in vdata["sign_date_m"]
    assert vdata["signing_time"] is not None
    assert "2026-02-15" in vdata["signing_time"]
    assert vdata["signer_tax_code"] == "4401053694"
    assert vdata["digest_algorithm"] == "SHA-256"
    assert "tax_compliance" in vdata
    assert vdata["tax_compliance"]["compliant"] is True
    assert "Foxit" in vdata["tax_compliance"]["foxit_reader_verdict"] or "Valid" in vdata["tax_compliance"]["foxit_reader_verdict"]
    assert len(vdata["tax_compliance"]["legal_bases"]) >= 3

    # 3. Test tampered PDF integrity check
    from app import storage
    pdf_bytes = bytearray(storage.read_doc(data["doc_id"]))
    # Tamper 1 byte in the middle of file
    pdf_bytes[len(pdf_bytes) // 2] ^= 0xAA
    storage.write_doc(data["doc_id"], bytes(pdf_bytes))

    bad_res = client.get(f"/api/piecework/contracts/{cid}/verify-signature")
    assert bad_res.status_code == 200
    bad_data = bad_res.json()
    assert bad_data["intact"] is False


def test_piecework_sign_inut_realtime(client):
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})

    list_res = client.get("/api/piecework/contracts")
    contracts = list_res.json()["contracts"]
    c = contracts[1]
    cid = c["id"]

    # Sign without body (realtime)
    sign_res = client.post(f"/api/piecework/contracts/{cid}/sign-inut")
    assert sign_res.status_code == 200
    data = sign_res.json()
    assert data["ok"] is True
    assert data["signed_at"] is not None

    verify_res = client.get(f"/api/piecework/contracts/{cid}/verify-signature")
    assert verify_res.status_code == 200
    vdata = verify_res.json()
    assert vdata["intact"] is True
    assert vdata["valid"] is True


def test_piecework_certificates_endpoint(client):
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    res = client.get("/api/piecework/certificates")
    assert res.status_code == 200
    data = res.json()
    assert "certificates" in data
    assert len(data["certificates"]) >= 1
    winca = next((c for c in data["certificates"] if "WINCA" in c.get("issuer", "").upper() or c.get("id") == "6616B8A61F228D0EAFF8AAF5F44F3ECD660DD8CD"), None)
    assert winca is not None
    assert winca["is_default"] is True
    assert "4401053694" in winca["subject"]

def test_piecework_upload_doc_and_deficiency_update(client):
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})

    # Create new contract to test fresh uploads
    create_res = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "TEST/2026/HĐGK-UPLOAD",
            "contract_type": "thi_cong",
            "project_name": "Dự án Thử Nghiệm Upload",
            "worker_name": "Trần Văn Thử Nghiệm",
            "worker_id_card": "038096001234",
            "total_amount": 7000000.0,
            "items": [{"ten": "Thi công hệ thống", "dvt": "Gói", "so_luong": 1, "don_gia": 7000000, "thanh_tien": 7000000}],
        },
    )
    assert create_res.status_code == 200
    cid = create_res.json()["id"]

    # 1. Upload invalid doc_kind -> 400
    dummy_file = ("test.pdf", b"%PDF-1.4 dummy file content", "application/pdf")
    inv_res = client.post(
        f"/api/piecework/contracts/{cid}/upload-doc",
        files={"file": dummy_file},
        data={"doc_kind": "invalid_kind"},
    )
    assert inv_res.status_code == 400

    # Helper to make valid tiny JPEG
    import io
    from PIL import Image
    img = Image.new("RGB", (640, 480), color="blue")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    valid_jpg_bytes = buf.getvalue()

    # 2. Upload id_card_front with real JPEG
    up_front = client.post(
        f"/api/piecework/contracts/{cid}/upload-doc",
        files={"file": ("cccd_truoc.jpg", valid_jpg_bytes, "image/jpeg")},
        data={"doc_kind": "id_card_front"},
    )
    assert up_front.status_code == 200
    res_front = up_front.json()
    assert res_front["ok"] is True
    assert res_front["doc_kind"] == "id_card_front"
    assert res_front["doc_id"] != ""
    assert res_front["validation"]["valid"] is True
    assert res_front["validation"]["dimensions"] == "640x480"
    front_doc_id = res_front["doc_id"]

    # 2b. Test file serving endpoint
    file_res = client.get(f"/api/piecework/docs/{front_doc_id}/file")
    assert file_res.status_code == 200
    assert file_res.headers["content-type"] == "image/jpeg"
    assert len(file_res.content) == len(valid_jpg_bytes)

    # 3. Upload id_card_back
    up_back = client.post(
        f"/api/piecework/contracts/{cid}/upload-doc",
        files={"file": ("cccd_sau.jpg", valid_jpg_bytes, "image/jpeg")},
        data={"doc_kind": "id_card_back"},
    )
    assert up_back.status_code == 200

    # 4. Upload acceptance
    up_acc = client.post(
        f"/api/piecework/contracts/{cid}/upload-doc",
        files={"file": ("bbnt.jpg", valid_jpg_bytes, "image/jpeg")},
        data={"doc_kind": "acceptance"},
    )
    assert up_acc.status_code == 200

    # 5. Upload site_photo
    up_photo = client.post(
        f"/api/piecework/contracts/{cid}/upload-doc",
        files={"file": ("hientruong.jpg", valid_jpg_bytes, "image/jpeg")},
        data={"doc_kind": "site_photo"},
    )
    assert up_photo.status_code == 200

    # 6. Upload tax_commitment
    up_tax = client.post(
        f"/api/piecework/contracts/{cid}/upload-doc",
        files={"file": ("camket08.jpg", valid_jpg_bytes, "image/jpeg")},
        data={"doc_kind": "tax_commitment"},
    )
    assert up_tax.status_code == 200

    # 7. Upload bank_proof
    up_unc = client.post(
        f"/api/piecework/contracts/{cid}/upload-doc",
        files={"file": ("unc.jpg", valid_jpg_bytes, "image/jpeg")},
        data={"doc_kind": "bank_proof"},
    )
    assert up_unc.status_code == 200
    assert up_unc.json()["deficiency"]["status_code"] == "completed"

    # 8. Test validate contract endpoint
    val_res = client.post(f"/api/piecework/contracts/{cid}/validate")
    assert val_res.status_code == 200
    v_data = val_res.json()
    assert v_data["ok"] is True
    assert v_data["deficiency"]["checklist"][0]["ok"] is True
    assert v_data["deficiency"]["checklist"][0]["validation"]["front"]["valid"] is True

    # 9. Test delete document endpoint
    del_doc = client.delete(f"/api/piecework/contracts/{cid}/docs/id_card_front")
    assert del_doc.status_code == 200
    assert del_doc.json()["deficiency"]["checklist"][0]["ok"] is False

    # 10. Test delete contract endpoint
    del_c = client.delete(f"/api/piecework/contracts/{cid}")
    assert del_c.status_code == 200
    assert del_c.json()["ok"] is True

    # Verify deleted in DB
    for db in get_session():
        assert db.get(PieceworkContract, cid) is None
        break

def test_piecework_worker_portal_signature_with_camera_face(client):
    portal_slug = "sonla-ll100-token-850082"
    
    # 1. Check portal HTML loads with camera preview
    portal_res = client.get(f"/khoan/{portal_slug}")
    assert portal_res.status_code == 200
    assert "camVideo" in portal_res.text
    assert "eKYC" in portal_res.text

    # 2. Submit signature with camera face photo
    dummy_sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    dummy_face = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="

    sub_res = client.post(
        f"/api/public/khoan/{portal_slug}/submit-signature",
        json={
            "signature_data": dummy_sig,
            "face_photo_data": dummy_face,
        }
    )
    assert sub_res.status_code == 200
    assert sub_res.json()["ok"] is True

    # 3. Login and check contract details
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    list_res = client.get("/api/piecework/contracts?q=SONLA")
    assert list_res.status_code == 200
    c_list = list_res.json()["contracts"]
    c_item = next(x for x in c_list if x["portal_token"] == portal_slug)
    cid = c_item["id"]

    det_res = client.get(f"/api/piecework/contracts/{cid}")
    assert det_res.status_code == 200
    det = det_res.json()
    assert det["is_signed_by_worker"] is True
    assert det["worker_face_photo_data"].startswith("data:image/jpeg")
    assert det["worker_face_doc_id"] != ""
    assert "worker_face" in det["attachments"]
    assert det["attachments"]["worker_face"] is not None
    assert det["attachments"]["worker_face"]["doc_id"] == det["worker_face_doc_id"]

    # 4. Check file serving for worker face photo
    face_doc_id = det["worker_face_doc_id"]
    face_file_res = client.get(f"/api/piecework/docs/{face_doc_id}/file")
    assert face_file_res.status_code == 200
    assert "image" in face_file_res.headers["content-type"]


def test_piecework_contractor_crud_and_smart_paste(client):
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})

    # 1. Test Smart Paste parser endpoint
    raw_chat = "em gui thong tin: Nguyen Van An, cccd 038092004512 cap ngay 15/04/2022 mst 8492004512 sdt 0912345678 stk 19034567891011 techcombank d/c To 2, Dong Son, Thanh Hoa"
    parse_res = client.post(
        "/api/piecework/contractors/parse-text",
        json={"text": raw_chat},
    )
    assert parse_res.status_code == 200
    p = parse_res.json()["parsed"]
    assert p["id_card"] == "038092004512"
    assert p["tax_code"] == "8492004512"
    assert p["phone"] == "0912345678"
    assert p["bank_name"] == "Techcombank"
    assert p["bank_account"] == "19034567891011"

    # 2. Test create contractor
    create_res = client.post(
        "/api/piecework/contractors",
        json={
            "code": "CTV-TEST-4512",
            "name": p["name"] or "Nguyen Van An",
            "id_card": p["id_card"],
            "id_card_date": p["id_card_date"] or "2022-04-15",
            "tax_code": p["tax_code"],
            "phone": p["phone"],
            "address": p["address"] or "To 2, Dong Son, Thanh Hoa",
            "bank_account": p["bank_account"],
            "bank_name": p["bank_name"],
            "skills": "Lap dat Kiosk AI",
        },
    )
    assert create_res.status_code == 200
    cntr_id = create_res.json()["id"]
    assert cntr_id > 0

    # 3. Test list contractors
    list_res = client.get("/api/piecework/contractors?q=TEST")
    assert list_res.status_code == 200
    assert len(list_res.json()["contractors"]) >= 1

    # 4. Test get contractor detail
    det_res = client.get(f"/api/piecework/contractors/{cntr_id}")
    assert det_res.status_code == 200
    assert det_res.json()["id_card"] == "038092004512"

    # 5. Test update contractor
    patch_res = client.patch(
        f"/api/piecework/contractors/{cntr_id}",
        json={"skills": "Lap dat Kiosk AI và tu dien"},
    )
    assert patch_res.status_code == 200

    # 6. Test delete contractor
    del_res = client.delete(f"/api/piecework/contractors/{cntr_id}")
    assert del_res.status_code == 200


def test_piecework_contractor_tax_summary_and_contract_link(client):
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})

    # 1. Tax summary for seeded contractor 1
    tax_res = client.get("/api/piecework/contractors/1/tax-summary?year=2026")
    assert tax_res.status_code == 200
    tdata = tax_res.json()
    assert tdata["ok"] is True
    assert tdata["contractor"]["id"] == 1
    assert tdata["summary"]["total_gross_income"] >= 4500000.0
    assert "Nghị định số 253/2026/NĐ-CP" in tdata["legal_bases"][0]
    assert "tax_refund_guidance" in tdata
    assert len(tdata["contracts"]) >= 1


def test_piecework_sync_drive(client, monkeypatch):
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})

    import subprocess
    orig_run = subprocess.run
    def mock_run(cmd, *args, **kwargs):
        if "copy" in cmd:
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")
        if "link" in cmd:
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="https://drive.google.com/open?id=test_mock_id\n", stderr="")
        return orig_run(cmd, *args, **kwargs)
    monkeypatch.setattr("subprocess.run", mock_run)

    # 1. Sync contract 1
    res = client.post("/api/piecework/contracts/1/sync-drive")
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "2026:Q" in data["quarter"]
    assert "HDGK_" in data["remote_dest"]
    assert "test_mock_id" in data["drive_link"]
    assert len(data["files"]) >= 3

    # Verify detail reflects sync
    det_res = client.get("/api/piecework/contracts/1")
    assert det_res.status_code == 200
    det = det_res.json()
    assert det["drive_synced_at"] is not None
    assert "test_mock_id" in det["drive_link"]

    # 2. Sync quarterly
    q_res = client.post("/api/piecework/sync-quarterly-drive?year=2026&quarter=3")
    assert q_res.status_code == 200
    qdata = q_res.json()
    assert qdata["ok"] is True
    assert qdata["synced_count"] >= 1
