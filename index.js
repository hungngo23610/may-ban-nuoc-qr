
const http = require("http");

const STK = process.env.STK;
const BANK = process.env.BANK || "ICB";
const API_KEY = process.env.API_KEY;

// VietinBank BIN
const BIN = "970415";

const donHang = {};

function tlv(tag, value) {
    value = String(value);
    return tag + String(value.length).padStart(2, "0") + value;
}

function crc16(text) {
    let crc = 0xFFFF;

    for (let i = 0; i < text.length; i++) {
        crc ^= text.charCodeAt(i) << 8;

        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }

            crc &= 0xFFFF;
        }
    }

    return crc.toString(16).toUpperCase().padStart(4, "0");
}

function taoVietQR(soTien, maDon) {
    const taiKhoan = String(STK || "").trim();

    if (!/^\d+$/.test(taiKhoan)) {
        throw new Error("STK khong hop le");
    }

    const noiDung = ("SEVQR " + maDon).toUpperCase();

    const thongTinTaiKhoan =
        tlv("00", BIN) +
        tlv("01", taiKhoan);

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

    if (Buffer.byteLength(payload, "utf8") > 192) {
        throw new Error("Chuoi QR vuot gioi han 192 byte");
    }

    return payload;
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    // Kiem tra server
    if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8"
        });
        res.end("May ban nuoc QR server dang hoat dong");
    }

    // Tao don va tao chuoi QR
    else if (req.method === "POST" && url.pathname === "/tao-don") {
        let body = "";

        req.on("data", data => {
            body += data;
        });

        req.on("end", () => {
            try {
                const don = JSON.parse(body);
                const maDon = "DH" + Date.now();

                let gia = 0;

                if (don.sanPham === "Tra") {
                    gia = 10000;
                } else if (don.sanPham === "Ca phe") {
                    gia = 15000;
                }

                if (gia === 0) {
                    res.writeHead(400, {
                        "Content-Type": "application/json; charset=utf-8"
                    });
                    res.end(JSON.stringify({
                        loi: "San pham khong hop le"
                    }));
                    return;
                }

                if (!STK || !API_KEY) {
                    res.writeHead(500, {
                        "Content-Type": "application/json; charset=utf-8"
                    });
                    res.end(JSON.stringify({
                        loi: "Server chua duoc cau hinh"
                    }));
                    return;
                }

                if (BANK !== "ICB") {
                    res.writeHead(500, {
                        "Content-Type": "application/json; charset=utf-8"
                    });
                    res.end(JSON.stringify({
                        loi: "Code QR hien tai chi cau hinh cho VietinBank ICB"
                    }));
                    return;
                }

                const qr = "https://qr.sepay.vn/img?acc="
                    + encodeURIComponent(STK)
                    + "&bank=" + encodeURIComponent(BANK)
                    + "&amount=" + gia
                    + "&des=" + encodeURIComponent("SEVQR " + maDon);

                const qrText = taoVietQR(gia, maDon);

                donHang[maDon] = {
                    sanPham: don.sanPham,
                    soTien: gia,
                    trangThai: "cho_thanh_toan"
                };

                console.log("Tao don:", maDon, gia);

                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8"
                });

                res.end(JSON.stringify({
                    maDon: maDon,
                    soTien: gia,
                    qrUrl: qr,
                    qrText: qrText,
                    trangThai: "cho_thanh_toan"
                }));
            } catch (err) {
                console.error("Loi tao don:", err.message);

                res.writeHead(400, {
                    "Content-Type": "application/json; charset=utf-8"
                });

                res.end(JSON.stringify({
                    loi: "Du lieu khong hop le hoac khong tao duoc QR"
                }));
            }
        });
    }

    // Kiem tra trang thai don
    else if (req.method === "GET" && url.pathname === "/trang-thai") {
        const maDon = url.searchParams.get("maDon");
        const don = donHang[maDon];

        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8"
        });

        if (!don) {
            res.end(JSON.stringify({
                trangThai: "khong_tim_thay"
            }));
        } else {
            res.end(JSON.stringify({
                maDon: maDon,
                trangThai: don.trangThai,
                soTien: don.soTien
            }));
        }
    }

    // Nhan webhook tu SePay
    else if (
        req.method === "POST" &&
        url.pathname === "/webhook/sepay"
    ) {
        if (
            !API_KEY ||
            req.headers.authorization !== "Apikey " + API_KEY
        ) {
            res.writeHead(401);
            res.end("Sai API Key");
            return;
        }

        let body = "";

        req.on("data", data => {
            body += data;
        });

        req.on("end", () => {
            try {
                const gd = JSON.parse(body);

                const noiDung = String(gd.content || "").toUpperCase();
                const tienNhan = Number(gd.transferAmount);

                const tienVao =
                    String(gd.transferType || "").toLowerCase() === "in";

                let daCapNhat = false;

                if (tienVao) {
                    for (const maDon in donHang) {
                        const don = donHang[maDon];

                        if (
                            noiDung.includes(maDon.toUpperCase()) &&
                            tienNhan === don.soTien &&
                            don.trangThai === "cho_thanh_toan"
                        ) {
                            don.trangThai = "thanh_cong";
                            daCapNhat = true;

                            console.log("DA THANH TOAN:", maDon);
                            break;
                        }
                    }
                }

                console.log("Webhook da xu ly. Cap nhat:", daCapNhat);

                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8"
                });

                // SePay yeu cau phan hoi thanh cong
                res.end('{"success": true}');
            } catch (err) {
                console.error("Loi webhook:", err.message);

                res.writeHead(400);
                res.end("Du lieu loi");
            }
        });
    }

    else {
        res.writeHead(404);
        res.end("Khong tim thay");
    }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("Server dang chay tai cong " + PORT);
});
