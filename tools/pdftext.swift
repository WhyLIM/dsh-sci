// dsh-sci —— macOS PDFKit 文本抽取兜底。
// 由 tools/lib/fulltext.mjs 在第一次需要时编译成 ~/.dsh/sci/bin/pdftext。
// 只读本地 PDF，不联网。
import Foundation
import PDFKit

let args = CommandLine.arguments
if args.count < 2 {
    FileHandle.standardError.write("usage: pdftext <file.pdf>\n".data(using: .utf8)!)
    exit(64)
}
let url = URL(fileURLWithPath: args[1])
guard let doc = PDFDocument(url: url) else {
    FileHandle.standardError.write("cannot open PDF\n".data(using: .utf8)!)
    exit(2)
}
if doc.isLocked {
    FileHandle.standardError.write("PDF is locked\n".data(using: .utf8)!)
    exit(3)
}
for i in 0..<doc.pageCount {
    if let page = doc.page(at: i), let s = page.string {
        print(s)
    }
    print("\u{0C}")
}
