
const http = require("http");

const STK = String(process.env.STK || "").trim();
const API_KEY = process.env.API_KEY || "";
const PORT = process.env.PORT || 3000;

const BANK = "ICB";
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
            crc = crc & 0x8000
                ? (crc << 1) ^ 0x1021
                : crc << 1;

            crc &= 0xFFFF;
        }
    }

    return crc.toString(16).toUpperCase().padStart(4, "0");
}

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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8"
        });
        return res.end("May ban nuoc QR server dang hoat dong");
    }

    if (req.method === "POST" && url.pathname === "/tao-don") {
        let body = "";

        req.on("data", chunk => {
            body += chunk;
            if (body.length > 10000) req.destroy();
        });

        req.on("end", () => {
            try {
                if (!STK || !/^\d+$/.test(STK) || !API_KEY) {
                    return guiJSON(res, 500, {
                        loi: "Kiem tra STK va API_KEY tren Render"
                    });
                }

                const don = JSON.parse(body);
                const giaTheoSanPham = {
                    "Tra": 10000,
                    "Ca phe": 15000
                };

                const gia = giaTheoSanPham[don.sanPham];

                if (!gia) {
                    return guiJSON(res, 400, {
                        loi: "San pham khong hop le"
                    });
                }

                const maDon = "DH" + Date.now();
                const qrText = taoVietQR(gia, maDon);

                const qrUrl =
                    "https://qr.sepay.vn/img?acc=" +
                    encodeURIComponent(STK) +
                    "&bank=" + encodeURIComponent(BANK) +
                    "&amount=" + gia +
                    "&des=" + encodeURIComponent("SEVQR " + maDon);

                donHang[maDon] = {
                    sanPham: don.sanPham,
                    soTien: gia,
                    trangThai: "cho_thanh_toan"
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
                    loi: "Khong tao duoc don hang"
                });
            }
        });

        return;
    }

    if (req.method === "GET" && url.pathname === "/trang-thai") {
        const maDon = url.searchParams.get("maDon");
        const don = donHang[maDon];

        return guiJSON(res, 200, don ? {
            maDon,
            trangThai: don.trangThai,
            soTien: don.soTien
        } : {
            maDon,
            trangThai: "khong_tim_thay"
        });
    }

    if (req.method === "POST" && url.pathname === "/webhook/sepay") {
        if (!API_KEY ||
            req.headers.authorization !== "Apikey " + API_KEY) {
            return guiJSON(res, 401, {
                loi: "Sai API Key"
            });
        }

        let body = "";

        req.on("data", chunk => {
            body += chunk;
            if (body.length > 100000) req.destroy();
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
                            noiDung.includes("SEVQR " + maDon.toUpperCase()) &&
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

                console.log("Webhook cap nhat:", daCapNhat);

                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8"
                });
                res.end('{"success": true}');
            } catch (err) {
                console.error("Loi webhook:", err.message);
                res.writeHead(400, {
                    "Content-Type": "application/json; charset=utf-8"
                });
                res.end('{"success": false}');
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
