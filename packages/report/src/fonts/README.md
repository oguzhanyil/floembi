# PDF yazı tipi

Roboto Regular ve Medium, Google'ın `roboto` deposundaki **v2.138** sürümünden değiştirilmeden alınmıştır.
Kaynak commit: `ab4876f650a4aeb9b661c83fee47f908c739bb70`; dizin: `src/hinted`.
Kaynak: https://github.com/googlefonts/roboto/tree/ab4876f650a4aeb9b661c83fee47f908c739bb70
Lisans: Apache-2.0, tam metin `LICENSE.txt` içindedir. Fontun telif bildirimi dosyaların içindedir.
PDF dışa aktarma bu fontları yerel paket içinde kullanır; dış font servisine veri gönderilmez.
Lisans metni uygulama paketine ve üretilen PDF'nin Subject üstverisine de eklenir.
`pdfmake/build/vfs_fonts` kullanılmaz; o paketteki güncel fontlar farklı lisanslıdır.
