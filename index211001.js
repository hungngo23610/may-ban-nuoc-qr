
const http = require("http");

const STK = String(process.env.STK || "").trim();
const API_KEY = process.env.API_KEY || "";
const PORT = process.env.PORT || 3000;

const BANK = "ICB";
const BIN = "970415";

// Don hang luu trong RAM
const donHang = {};

function tlv(tag, value) {
    value = String(value);
    return tag + String(value.length).padStart(2, "0") + value;
}

// CRC16-CCITT-FALSE
function crc16(text) {
    let crc = 0xFFFF;

    for (let i = 0; i < text.length; i++) {
        crc ^= text.charCodeAt(i) << 8;

        for (let j = 0; j < 8; j++) {
            crc = crc & 0x8000
                ? (crc << 1) ^ 0x1021
                : crc << 1;

            crc &= 0xFFFF;
        }
    }

    return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Tao chuoi VietQR cho Nextion
function taoVietQR(soTien, maDon) {
    if (!/^\d+$/.test(STK)) {
        throw new Error("STK khong hop le");
    }

    const noiDung = ("SEVQR " + maDon).toUpperCase();

    const thongTinTaiKhoan =
        tlv("00", BIN) +
        tlv("01", STK);

    const merchantAccount =
        tlv("00", "A000000727") +
        tlv("01", thongTinTaiKhoan) +
        tlv("02", "QRIBFTTA");

    let payload =
        tlv("00", "01") +
        tlv("01", "12") +
        tlv("38", merchantAccount) +
        tlv("52", "0000") +
        tlv("53", "704") +
        tlv("54", soTien) +
        tlv("58", "VN") +
        tlv("62", tlv("08", noiDung)) +
        "6304";

    payload += crc16(payload);

    return payload;
}

function guiJSON(res, status, data) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    // Kiem tra server
    if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        return res.end("May ban nuoc QR server dang hoat dong");
    }

    // Tao don hang
    if (req.method === "POST" && url.pathname === "/tao-don") {
        let body = "";

        req.on("data", chunk => {
            body += chunk;

            if (body.length > 10000) {
                req.destroy();
            }
        });

        req.on("end", () => {
            try {
                if (!STK || !/^\d+$/.test(STK)) {
                    return guiJSON(res, 500, {
                        loi: "STK tren Render chua dung"
                    });
                }

                if (!API_KEY) {
                    return guiJSON(res, 500, {
                        loi: "Thieu API_KEY tren Render"
                    });
                }

                const don = JSON.parse(body);
                const sanPham = String(don.sanPham || "");

                const bangGia = {
                    "Tra": 10000,
                    "Ca phe": 15000
                };

                const gia = bangGia[sanPham];

                if (!gia) {
                    return guiJSON(res, 400, {
                        loi: "San pham khong hop le"
                    });
                }

                const maDon = "DH" + Date.now();

                const qrText = taoVietQR(gia, maDon);

                // Anh QR dung de kiem tra, khong phai qrText
                const qrUrl =
                    "https://qr.sepay.vn/img?acc=" +
                    encodeURIComponent(STK) +
                    "&bank=" + BANK +
                    "&amount=" + gia +
                    "&des=" + encodeURIComponent("SEVQR " + maDon);

                donHang[maDon] = {
                    sanPham,
                    soTien: gia,
                    trangThai: "cho_thanh_toan",
                    taoLuc: Date.now()
                };

                console.log("Tao don:", maDon, gia);

                return guiJSON(res, 200, {
                    maDon,
                    soTien: gia,
                    qrText,
                    qrUrl,
                    trangThai: "cho_thanh_toan"
                });
            } catch (err) {
                console.error("Loi tao don:", err.message);

                return guiJSON(res, 400, {
                    loi: "Du lieu khong hop le hoac khong tao duoc QR"
                });
            }
        });

        return;
    }

    // Nextion/ESP32 kiem tra thanh toan
    if (req.method === "GET" && url.pathname === "/trang-thai") {
        const maDon = url.searchParams.get("maDon");
        const don = donHang[maDon];

        if (!don) {
            return guiJSON(res, 200, {
                maDon,
                trangThai: "khong_tim_thay"
            });
        }

        return guiJSON(res, 200, {
            maDon,
            trangThai: don.trangThai,
            soTien: don.soTien
        });
    }

    // SePay gui thong bao giao dich vao
    if (req.method === "POST" && url.pathname === "/webhook/sepay") {
        if (
            !API_KEY ||
            req.headers.authorization !== "Apikey " + API_KEY
        ) {
            return guiJSON(res, 401, {
                loi: "Sai API Key"
            });
        }

        let body = "";

        req.on("data", chunk => {
            body += chunk;

            if (body.length > 100000) {
                req.destroy();
            }
        });

        req.on("end", () => {
            try {
                const gd = JSON.parse(body);
                const noiDung = String(gd.content || "").toUpperCase();
                const tienNhan = Number(gd.transferAmount);
                const tienVao =
                    String(gd.transferType || "").toLowerCase() === "in";

                let daCapNhat = false;

                if (tienVao && Number.isFinite(tienNhan)) {
                    for (const maDon in donHang) {
                        const don = donHang[maDon];

                        if (
                            noiDung.includes("SEVQR " + maDon) &&
                            tienNhan === don.soTien &&
                            don.trangThai === "cho_thanh_toan"
                        ) {
                            don.trangThai = "thanh_cong";
                            don.thanhToanLuc = Date.now();

                            console.log("DA THANH TOAN:", maDon);
                            daCapNhat = true;
                            break;
                        }
                    }
                }

                console.log("Webhook xu ly. Cap nhat:", daCapNhat);

                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8"
                });

                return res.end('{"success": true}');
            } catch (err) {
                console.error("Loi webhook:", err.message);

                res.writeHead(400, {
                    "Content-Type": "application/json; charset=utf-8"
                });

                return res.end('{"success": false}');
            }
        });

        return;
    }

    res.writeHead(404);
    res.end("Khong tim thay");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("Server dang chay tai cong " + PORT);
});
